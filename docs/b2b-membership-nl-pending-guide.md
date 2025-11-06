# B2B Membership: Adding Pending Memberships for Netherlands (NL)

> **Purpose**: Guide for adding pending corporate memberships for the Netherlands market
> 
> **Service**: `b2b-membership`
> 
> **Pattern**: CSV bulk upload with S3-triggered processing

---

## Overview

Pending memberships allow organizations to pre-populate employee eligibility before employees register. When an employee signs up and matches their credentials (e.g., employee ID + date of birth), the membership is claimed and the `userId` is populated.

---

## System Architecture

```mermaid
graph TB
    subgraph "1. CSV Upload Flow"
        Client[Back Office User]
        API[API Gateway: POST /csv/upload]
        Lambda1[Upload Handler Lambda]
        S3[S3 Bucket: Presigned URL]
        Client -->|Request upload URL| API
        API --> Lambda1
        Lambda1 -->|Generate presigned URL| S3
        Lambda1 -->|Return URL| Client
        Client -->|Upload CSV| S3
    end
    
    subgraph "2. Processing Flow"
        S3 -->|ObjectCreated Event| SQS[SQS Queue]
        SQS --> Lambda2[CSV Handler Lambda]
        Lambda2 -->|Parse CSV| Parser[Schema Validator]
        Parser -->|Transform| Transformer[Map to DB Schema]
        Transformer -->|Batch Upsert| RDS[(PostgreSQL RDS)]
    end
    
    subgraph "3. Patient Claim Flow (Optional)"
        Patient[Patient Registration]
        MatchAPI[Membership Match API]
        Patient -->|Provide credentials| MatchAPI
        MatchAPI -->|Query match| RDS
        RDS -->|Found match| MatchAPI
        MatchAPI -->|Update userId| RDS
    end
    
    style RDS fill:#e1f5ff
    style S3 fill:#fff4e6
    style Lambda2 fill:#f3e5f5
```

---

## Database Schema: B2BMemberships Table

```mermaid
erDiagram
    B2BMemberships {
        uuid membershipId PK "Auto-generated UUID"
        int countryId "Country ID (NL = 528)"
        int userId "NULL for pending, patient ID when claimed"
        string primaryOrganizationId "Employee ID / Member Number"
        string complementaryOrganizationId "Date of Birth / Secondary ID"
        string organizationName "Company name"
        string membershipType "STANDARD or STAFF"
        string membershipStatus "ACTIVE, PENDING, BLOCKED_BY_CUSTOMER"
        date expiresAt "Membership expiry date"
        timestamp createdAt "Auto-set"
        timestamp updatedAt "Auto-set"
    }
```

**Key Fields for Pending Memberships**:
- `userId`: **NULL** = pending membership (not yet claimed by patient)
- `membershipStatus`: **"ACTIVE"** = eligible to claim
- `primaryOrganizationId`: Employee ID used for matching
- `complementaryOrganizationId`: Date of birth (YYYY-MM-DD) for verification

---

## Implementation Steps

### Step 1: Define NL Input Schema

Add to `/services/b2b-membership/src/csv/inputSchemas.ts`:

```typescript
export const sharedInputSchemaFields = {
  vitality: { /* ... existing ... */ },
  
  // Add NL organization config
  nlOrganization: {
    organizationName: "example-nl-company",
    staffOrganizationName: "example-nl-company-staff",
    countryId: Countries.NL, // NL country ID
  },
} as const;

export const inputSchemas: Record<B2BClients, InputToMembershipSchema> = {
  vitality: { /* ... existing ... */ },
  
  // Add NL organization schema
  "nl-organization": z.object({
    EMPLOYEE_ID: z.string().min(1, "Employee ID required"),
    DATE_OF_BIRTH: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
    MEMBERSHIP_EXPIRY: z.preprocess(
      (val) => (typeof val === "string" ? new Date(val) : val),
      z.date(),
    ),
    MEMBERSHIP_TYPE: z.enum(["STANDARD", "STAFF"]).default("STANDARD"),
  }).transform(({
    EMPLOYEE_ID,
    DATE_OF_BIRTH,
    MEMBERSHIP_EXPIRY,
    MEMBERSHIP_TYPE,
  }): MembershipDbInput => ({
    countryId: sharedInputSchemaFields.nlOrganization.countryId,
    userId: null, // Pending membership
    primaryOrganizationId: EMPLOYEE_ID,
    complementaryOrganizationId: DATE_OF_BIRTH,
    organizationName: MEMBERSHIP_TYPE === "STAFF" 
      ? sharedInputSchemaFields.nlOrganization.staffOrganizationName
      : sharedInputSchemaFields.nlOrganization.organizationName,
    membershipType: MEMBERSHIP_TYPE,
    membershipStatus: "ACTIVE", // Ready to be claimed
    expiresAt: MEMBERSHIP_EXPIRY,
  })),
};
```

### Step 2: Prepare CSV File

**Format**: `nl-organization.csv`

```csv
EMPLOYEE_ID,DATE_OF_BIRTH,MEMBERSHIP_EXPIRY,MEMBERSHIP_TYPE
EMP12345,1990-05-15,2025-12-31,STANDARD
EMP67890,1985-03-22,2025-12-31,STANDARD
STAFF001,1978-11-30,2025-12-31,STAFF
```

### Step 3: Upload CSV via API

```bash
# 1. Get presigned upload URL
curl -X POST https://api.mindler.com/b2b-membership/csv/upload \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"clientName": "nl-organization"}'

# Response: { "uploadUrl": "https://s3.amazonaws.com/...", "key": "..." }

# 2. Upload CSV to presigned URL
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: text/csv" \
  --data-binary @nl-organization.csv
```

### Step 4: Automatic Processing

```mermaid
sequenceDiagram
    participant S3
    participant SQS
    participant Lambda as CSV Handler Lambda
    participant Parser as Schema Validator
    participant RDS as PostgreSQL
    
    S3->>SQS: ObjectCreated event
    Note over S3,SQS: S3 event triggers SQS message
    
    SQS->>Lambda: Invoke with S3 object key
    Lambda->>S3: Download CSV file
    S3-->>Lambda: CSV content
    
    Lambda->>Parser: Parse rows with schema
    Note over Parser: Validate against<br/>nl-organization schema
    
    Parser-->>Lambda: Validated membership objects
    
    Lambda->>RDS: Batch upsert memberships
    Note over RDS: userId = null<br/>membershipStatus = ACTIVE
    
    RDS-->>Lambda: Success
    Lambda->>SQS: Delete message
```

---

## Membership Claim Flow (When Patient Registers)

```mermaid
sequenceDiagram
    participant Patient
    participant API as Membership Match API
    participant RDS as B2BMemberships Table
    
    Patient->>API: Register with Employee ID + DOB
    Note over Patient,API: POST /memberships/claim<br/>{employeeId, dateOfBirth}
    
    API->>RDS: Query pending memberships
    Note over RDS: WHERE userId IS NULL<br/>AND primaryOrganizationId = employeeId<br/>AND complementaryOrganizationId = dateOfBirth<br/>AND membershipStatus = 'ACTIVE'
    
    alt Match Found
        RDS-->>API: Return matching membership
        API->>RDS: UPDATE userId = patientUserId
        API-->>Patient: Success: Membership activated
    else No Match
        RDS-->>API: No results
        API-->>Patient: Error: No matching membership
    end
```

---

## Key Implementation Details

### Countries Enum (from existing code)
```typescript
export const Countries = {
  SE: 752,  // Sweden
  UK: 826,  // United Kingdom
  NL: 528,  // Netherlands
} as const;
```

### Database Query for Pending Memberships
```typescript
// Find pending membership for claiming
const pendingMembership = await db("B2BMemberships")
  .where({
    countryId: Countries.NL,
    primaryOrganizationId: employeeId,
    complementaryOrganizationId: dateOfBirth,
    membershipStatus: "ACTIVE",
  })
  .whereNull("userId")
  .first();

// Claim membership
if (pendingMembership) {
  await db("B2BMemberships")
    .where({ membershipId: pendingMembership.membershipId })
    .update({
      userId: patientUserId,
      updatedAt: new Date(),
    });
}
```

---

## Testing Checklist

- [ ] Schema validation works for NL CSV format
- [ ] CSV upload generates presigned S3 URL
- [ ] S3 ObjectCreated event triggers Lambda
- [ ] Lambda parses CSV and validates rows
- [ ] Database inserts with `userId = null` and `countryId = NL (528)`
- [ ] Patient registration can query and claim pending membership
- [ ] `userId` updates correctly when claimed
- [ ] Expired memberships (`expiresAt < NOW()`) are handled

---

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| CSV upload fails | Invalid schema name | Ensure client name matches schema key: `"nl-organization"` |
| No memberships inserted | CSV format mismatch | Validate CSV headers match schema fields exactly |
| Patient can't claim | Wrong date format | `DATE_OF_BIRTH` must be `YYYY-MM-DD` string |
| Duplicate memberships | Re-uploading same CSV | Use upsert logic on `(countryId, primaryOrganizationId)` |

---

## Summary: Quick Start

1. **Add NL schema** to `inputSchemas.ts` with employee ID + DOB matching
2. **Prepare CSV** with columns: `EMPLOYEE_ID`, `DATE_OF_BIRTH`, `MEMBERSHIP_EXPIRY`, `MEMBERSHIP_TYPE`
3. **Upload CSV** via API → S3 presigned URL
4. **Lambda auto-processes** → Inserts rows with `userId = null` (pending)
5. **Patient claims** → Match on employee ID + DOB → `userId` populated

---

**Related Files**:
- Schema: `/services/b2b-membership/src/csv/inputSchemas.ts`
- CSV Handler: `/services/b2b-membership/src/csv/handler.ts`
- Upload API: `/services/b2b-membership/src/csv/upload/handler.ts`
- Database Migration: `/services/b2b-membership/infra/db/migrations/20221123084119_initialSetup.ts`
