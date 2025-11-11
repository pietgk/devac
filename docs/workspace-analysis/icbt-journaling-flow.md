# iCBT Journaling Flow: Complete Architecture

> **Purpose**: How iCBT (Internet-based Cognitive Behavioral Therapy) program completions are journaled to Webdoc
> 
> **Services Involved**: indianapolis, health-profiles, webdoc-hook
> 
> **Last Updated**: 2025-01-06

---

## Overview

When a patient completes an iCBT program, it must be journaled to the external Webdoc system. This involves three microservices working together through event-driven architecture.

```mermaid
graph LR
    Patient[Patient Completes<br/>iCBT Program] --> Indianapolis[indianapolis<br/>DynamoDB Stream]
    Indianapolis -->|SQS Message| Webdoc[webdoc-hook<br/>Journaling Service]
    Webdoc -->|Query| HealthProfiles[health-profiles<br/>Assignment Check]
    Webdoc -->|HTTP| WebdocAPI[Webdoc External API<br/>Journal Entry]
    
    style Indianapolis fill:#4CAF50
    style Webdoc fill:#FF9800
    style HealthProfiles fill:#2196F3
```

---

## Architecture: Three-Service Pattern

```mermaid
graph TB
    subgraph "1. Indianapolis Service"
        DDB[DynamoDB Progress Table<br/>User program progress]
        Stream[DynamoDB Stream<br/>Change capture]
        StreamLambda[Stream Handler Lambda]
        Contentful[Contentful CMS<br/>Program definitions]
    end
    
    subgraph "2. Health-Profiles Service"
        HPDB[(health_profiles_db<br/>PostgreSQL)]
        HPAPI[Health Profiles API<br/>POST /icbt_requests/is_assigned]
    end
    
    subgraph "3. Webdoc-Hook Service"
        Queue[WebdocIndianapolis.fifo<br/>SQS Queue]
        WebdocLambda[Program Completed Handler]
        DynamoTable[DynamoDB WebdocMappings<br/>ID mapping table]
        WebdocExternal[Webdoc API<br/>External journal system]
    end
    
    DDB -->|Stream events| Stream
    Stream -->|Trigger| StreamLambda
    StreamLambda -->|Check completion| Contentful
    StreamLambda -->|Send message| Queue
    
    Queue -->|Trigger| WebdocLambda
    WebdocLambda -->|Check assignment| HPAPI
    HPAPI --> HPDB
    WebdocLambda -->|Get mapping| DynamoTable
    WebdocLambda -->|Create journal entry| WebdocExternal
    WebdocLambda -->|Save mapping| DynamoTable
    
    style DDB fill:#e1f5ff
    style Queue fill:#fff4e6
    style StreamLambda fill:#f3e5f5
    style WebdocLambda fill:#f3e5f5
```

---

## Complete Flow: Step by Step

```mermaid
sequenceDiagram
    participant Patient
    participant DDB as DynamoDB Progress
    participant Stream as DynamoDB Stream
    participant Indianapolis as indianapolis Lambda
    participant Contentful as Contentful CMS
    participant SQS as WebdocIndianapolis.fifo
    participant Webdoc as webdoc-hook Lambda
    participant HP as health-profiles API
    participant Dynamo as DynamoDB Mappings
    participant External as Webdoc External API
    
    Patient->>DDB: Complete iCBT program<br/>(PageId = lastPageId)
    DDB->>Stream: Stream event (INSERT/MODIFY)
    Stream->>Indianapolis: Trigger Lambda
    
    Indianapolis->>Contentful: Get program data<br/>(title, lastPageId, free status)
    Contentful-->>Indianapolis: Program metadata
    
    Indianapolis->>Indianapolis: Check if completed<br/>(MaxProgressedPage == lastPageId)
    
    alt Program completed & not journaled before
        Indianapolis->>SQS: Send ProgramCompleted message<br/>{userId, programId, completedAt, etc.}
        Note over Indianapolis,SQS: Message deduplication by uniqueIdentifier
        
        Indianapolis->>DDB: Update DynamoDB<br/>SET SentToJournal=true, CompletedAt=now
    else Not completed or already journaled
        Indianapolis->>Indianapolis: Skip journaling
    end
    
    SQS->>Webdoc: Trigger Lambda (FIFO order)
    
    Webdoc->>HP: POST /icbt_requests/is_assigned<br/>{userId, programId}
    HP-->>Webdoc: {isAssigned: boolean, count: number}
    
    alt Is assigned program
        Webdoc->>Dynamo: Check for existing patient mapping
        
        alt No mapping exists
            Webdoc->>External: Create patient in Webdoc
            External-->>Webdoc: Webdoc patient ID
            Webdoc->>Dynamo: Save mapping (MindlerID → WebdocID)
        end
        
        Webdoc->>External: Create journal entry<br/>(booking + visit + iCBT note)
        External-->>Webdoc: Success
        
        Webdoc->>Dynamo: Update iCBT status to "synced"
    else Not assigned (standalone program)
        Webdoc->>Webdoc: Schedule for later (non-B2B logic)
    end
```

---

## Service 1: Indianapolis (Program Completion Detection)

### Purpose
Detect when patients complete iCBT programs and queue them for journaling.

### DynamoDB Progress Table Schema

```typescript
{
  PK: "USER#123",                    // Patient user ID
  SK: "PROGRAM#abc-def",             // Program ID or STANDALONE_PROGRAM#...
  ProgramId: "abc-def",              // Contentful program ID
  TreatmentId?: "treatment-123",     // Treatment ID (if not standalone)
  PageId: "page-xyz",                // Current page ID
  MaxProgressedPage: "page-xyz",     // Furthest page reached
  CountryCode: "SE",                 // Market
  CompanyName?: "Vitality",          // B2B company (if applicable)
  AssignId?: "assign-uuid",          // Assignment ID from health-profiles
  Completed: true,                   // Calculated: MaxProgressedPage == lastPageId
  CompletedAt?: "2025-01-06T10:30:00Z",  // When completed
  SentToJournal: true,               // Journaling status
  IsFree: false,                     // Should be reimbursed?
  IsStandalone: true,                // Standalone vs treatment program
  ContentLanguageUsed: "sv"          // Language used by patient
}
```

### DynamoDB Stream Handler Logic

```mermaid
flowchart TB
    Start[DynamoDB Stream Event] --> Parse[Parse NewImage \& OldImage]
    Parse --> CheckAssign{AssignId changed?}
    
    CheckAssign -->|Yes - Unassigned| Revert[Revert archived progress]
    CheckAssign -->|Yes - Assigned| Archive[Archive old progress]
    CheckAssign -->|No| CheckPage{PageId changed?}
    
    CheckPage -->|No| Skip[Skip processing]
    CheckPage -->|Yes| Contentful[Get program data from Contentful]
    
    Contentful --> CheckComplete{MaxProgressedPage == lastPageId?}
    
    CheckComplete -->|No| UpdateActivity[Update patient activity status]
    CheckComplete -->|Yes| CheckJournaled{Already journaled?<br/>oldImage. SentToJournal<br/>or oldImage.CompletedAt}
    
    CheckJournaled -->|Yes| UpdateActivity
    CheckJournaled -->|No| CheckFeature{Journal integration<br/>enabled?}
    
    CheckFeature -->|No| UpdateStatus[Update completion status only]
    CheckFeature -->|Yes| SendSQS[Send message to<br/>WebdocIndianapolis.fifo]
    
    SendSQS --> UpdateDDB[Update DynamoDB:<br/>SentToJournal=true<br/>CompletedAt=now]
    
    UpdateActivity --> End[End]
    UpdateStatus --> End
    UpdateDDB --> End
    Archive --> End
    Revert --> End
    Skip --> End
```

### Program Completed Message Schema

```typescript
interface ProgramCompleted {
  uniqueIdentifier: string;  // "userId-programId" or "userId-programId-assignId"
  userId: number;
  programId: string;
  programTitle: string;      // From Contentful (Swedish)
  completedAt: Date;
  companyName?: string;      // B2B company name
  free: boolean;             // From treatment definition
  isAssigned: boolean;       // From health-profiles
  treatmentId: string;
  isStandalone: boolean;
}
```

---

## Service 2: Health-Profiles (Assignment Check)

### Purpose
Determine if the completed program was assigned by a psychologist (vs patient self-starting).

### API Endpoint

**POST** `/icbt_requests/is_assigned`

```typescript
// Request
{
  userId: string,
  programId: string
}

// Response
{
  data: {
    isAssigned: boolean,      // True if psychologist assigned this program
    hasResponseOrIsPending?: boolean,
    count: number             // Number of assignments
  }
}
```

### Database Query

```sql
SELECT COUNT(*) as count
FROM IcbtRequests
WHERE patientUserId = :userId
  AND programId = :programId
  AND status IN ('ASSIGNED', 'IN_PROGRESS')
```

**Logic**:
- `isAssigned = count > 0`
- Assigned programs → Reimbursable, must be journaled
- Non-assigned programs → Patient self-started, different billing

---

## Service 3: Webdoc-Hook (Journal Entry Creation)

### Purpose
Create journal entries in external Webdoc system when iCBT programs are completed.

### SQS Queue Configuration

**Queue Name**: `WebdocIndianapolis.fifo`
- **Type**: FIFO (ordered processing per patient)
- **Message Group ID**: `userId` (ensures order per patient)
- **Deduplication ID**: `uniqueIdentifier` (prevents duplicate journals)
- **DLQ**: `WebdocIndianapolisDLQ.fifo`

### Handler Flow

```mermaid
flowchart TB
    Start[SQS Message Received] --> Parse[Parse ProgramCompleted message]
    Parse --> Validate{Validation checks}
    
    Validate -->|Too old| Reject[Reject: Completed > 30 days ago]
    Validate -->|Future date| Reject2[Reject: CompletedAt in future]
    Validate -->|Duplicate| Skip[Skip: Already exists]
    
    Validate -->|Valid| CheckType{B2B or Regular?}
    
    CheckType -->|B2B Program| ScheduleB2B[Schedule B2B iCBT<br/>Date: NOW]
    CheckType -->|Regular Program| ScheduleRegular[Schedule Regular iCBT<br/>Date: calculated with spacing]
    
    ScheduleB2B --> SaveDynamo[Save to DynamoDB<br/>type: icbt_patient_b2b]
    ScheduleRegular --> SaveDynamo2[Save to DynamoDB<br/>type: icbt_patient]
    
    SaveDynamo --> CronJob[Wait for cron job<br/>syncIcbts runs daily]
    SaveDynamo2 --> CronJob
    
    CronJob --> Query[Query scheduled iCBTs<br/>for yesterday]
    Query --> CheckCollision{Visit same day?}
    
    CheckCollision -->|Yes| PushDay[Push iCBT to next day]
    CheckCollision -->|No| GetPatient[Get patient details<br/>from MindlerDB]
    PushDay --> GetPatient
    
    GetPatient --> CheckMapping{Patient exists<br/>in Webdoc?}
    
    CheckMapping -->|No| CreatePatient[Create Webdoc patient]
    CreatePatient --> SaveMapping[Save mapping to DynamoDB]
    
    CheckMapping -->|Yes| CreateJournal[Create journal entries:<br/>1. Booking<br/>2. Visit<br/>3. iCBT Note]
    SaveMapping --> CreateJournal
    
    CreateJournal --> UpdateStatus[Update DynamoDB:<br/>type: synced_icbt_patient]
    
    UpdateStatus --> End[End]
    Reject --> DLQ[Send to DLQ]
    Reject2 --> DLQ
```

### DynamoDB Mappings Table

Stores mappings between Mindler IDs and Webdoc IDs.

```typescript
{
  typeId: "icbt#patient#123",           // PK: Composite key
  date: "2025-01-06T00:00:00.000Z",    // SK: Scheduling date
  type: "icbt_patient",                 // Status: icbt_patient, synced_icbt_patient
  exerciseName: "Program Title",        // Display name
  uniqueIdentifier?: "123-abc-def",     // Deduplication key
  companyName?: "Vitality",             // B2B company
  webdocPatientId?: "W12345",           // Webdoc patient ID (after sync)
  webdocBookingId?: "B67890",           // Webdoc booking ID (after sync)
  webdocVisitId?: "V11111"              // Webdoc visit ID (after sync)
}
```

**Type States**:
- `icbt_patient` / `icbt_patient_b2b` → Scheduled, pending sync
- `synced_icbt_patient` / `synced_icbt_patient_b2b` → Successfully journaled
- `deleted_icbt_patient` / `deleted_icbt_patient_b2b` → Deleted
- `synced_error_icbt_patient` → Failed to journal

### Scheduling Logic

**Regular iCBTs** (Non-B2B):
```typescript
// Minimum 7 days between iCBT journal entries per patient
const ICBT_SCHEDULING_INTERVAL = 7; // days

function getICBTSchedulingDate(lastScheduledICBT: Date | null): Date {
  if (!lastScheduledICBT) {
    return new Date(); // First iCBT, schedule immediately
  }
  
  const nextDate = new Date(
    lastScheduledICBT.getTime() + (7 * 24 * 60 * 60 * 1000)
  );
  
  // If calculated date is in the past, schedule today
  if (nextDate < new Date()) {
    return new Date();
  }
  
  // Don't schedule more than 14 days in the future
  const maxFutureDate = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));
  if (nextDate > maxFutureDate) {
    return new Date(lastScheduledICBT.getTime() + 1); // 1ms later for uniqueness
  }
  
  return nextDate;
}
```

**B2B iCBTs**:
- Always scheduled immediately (no spacing required)
- Journaled right away

### Collision Detection

```typescript
// If patient has a therapy session on the same day as scheduled iCBT,
// push iCBT journal entry to the next day
async function addOneDayIfCollidingVisit(
  icbtDate: Date, 
  lastVisitDate: Date | null
): Promise<Date> {
  if (!lastVisitDate) return icbtDate;
  
  const sameDay = 
    icbtDate.toDateString() === lastVisitDate.toDateString();
  
  if (sameDay) {
    // Push to next day to avoid same-day collision
    return new Date(icbtDate.getTime() + (24 * 60 * 60 * 1000));
  }
  
  return icbtDate;
}
```

### Webdoc API Integration

```mermaid
sequenceDiagram
    participant Lambda as webdoc-hook
    participant Webdoc as Webdoc API
    
    Lambda->>Webdoc: 1. Create/Get Patient
    Webdoc-->>Lambda: Patient ID
    
    Lambda->>Webdoc: 2. Create Booking
    Note over Lambda,Webdoc: Booking details:<br/>- Patient ID<br/>- Psychologist ID<br/>- Start time<br/>- Duration
    Webdoc-->>Lambda: Booking ID
    
    Lambda->>Webdoc: 3. Create Visit
    Note over Lambda,Webdoc: Visit details:<br/>- Booking ID<br/>- Status: completed<br/>- Visit type
    Webdoc-->>Lambda: Visit ID
    
    Lambda->>Webdoc: 4. Create Journal Entry (iCBT Note)
    Note over Lambda,Webdoc: Journal details:<br/>- Visit ID<br/>- Note type: iCBT<br/>- Program title<br/>- Completion date<br/>- Content/exercises
    Webdoc-->>Lambda: Journal Entry ID
```

---

## Key Design Decisions

### 1. Why DynamoDB Stream in Indianapolis?

**Problem**: Need to detect program completion in real-time.

**Solution**: DynamoDB Streams provide change data capture.

**Benefit**:
- Immediate reaction to progress updates
- Decoupled from API layer
- Reliable event delivery

### 2. Why SQS Queue Between Services?

**Problem**: Indianapolis and webdoc-hook are independent services.

**Solution**: FIFO SQS queue for async communication.

**Benefits**:
- Decoupling (services don't call each other directly)
- Resilience (retries with DLQ)
- Ordering (FIFO ensures per-patient order)
- Deduplication (prevents duplicate journal entries)

### 3. Why Check health-profiles for Assignment?

**Problem**: Need to know if psychologist assigned the program.

**Solution**: Query health-profiles API during journaling.

**Reason**:
- Assigned programs are reimbursable
- Different billing logic for assigned vs self-started
- health-profiles owns the assignment data

### 4. Why Schedule iCBTs with Spacing?

**Problem**: Can't journal all completed programs immediately.

**Solution**: 7-day minimum spacing between iCBT journal entries.

**Reason**:
- Reimbursement rules (max frequency per patient)
- Avoid flooding Webdoc with entries
- Collision detection with therapy sessions

### 5. Why DynamoDB Mappings Table?

**Problem**: Need to track Mindler ID → Webdoc ID mappings.

**Solution**: Dedicated DynamoDB table for ID mapping.

**Benefits**:
- Persistent mapping storage
- Fast lookups during sync
- Idempotency (check if already synced)

---

## Error Handling & Retry Logic

### Indianapolis → SQS

```mermaid
flowchart LR
    Stream[DynamoDB Stream] -->|Fails| Retry1[AWS Retry 1]
    Retry1 -->|Fails| Retry2[AWS Retry 2]
    Retry2 -->|Fails| Retry3[AWS Retry 3]
    Retry3 -->|Still fails| DLQ[Stream DLQ]
    
    Retry1 -->|Success| Done[Update DynamoDB]
    Retry2 -->|Success| Done
    Retry3 -->|Success| Done
```

**Retry Strategy**:
- Factor: 1.3
- Max retries: 10
- Min timeout: 5 seconds
- Max timeout: 30 seconds
- Total duration: ~5 minutes (lambda timeout)

### SQS → webdoc-hook

```mermaid
flowchart LR
    SQS[SQS Message] -->|Fails| Retry1[SQS Retry 1]
    Retry1 -->|Fails| Retry2[SQS Retry 2]
    Retry2 -->|Fails| Retry3[SQS Retry 3]
    Retry3 -->|Still fails| DLQ[WebdocIndianapolisDLQ.fifo]
    
    Retry1 -->|Success| Synced[Mark as synced]
    Retry2 -->|Success| Synced
    Retry3 -->|Success| Synced
```

**Failure Scenarios**:
- Health-profiles API down → Retry with exponential backoff
- Webdoc API down → Retry, then DLQ
- Duplicate entry → Skip (idempotent)
- Too old (>30 days) → Reject to DLQ

---

## Monitoring & Observability

### Key Metrics

| Metric | Source | Purpose |
|--------|--------|---------|
| `scheduleICBTEvent` count | indianapolis | Programs queued for journaling |
| `scheduleB2BICBTEvent` count | indianapolis | B2B programs queued |
| `numScheduledIcbt` count | webdoc-hook | iCBTs scheduled in DynamoDB |
| `numSyncedIcbt` count | webdoc-hook | iCBTs successfully journaled |
| DLQ message count | CloudWatch | Failed messages requiring manual intervention |

### Log Patterns

```typescript
// Indianapolis
logger.debug("Send program completed with messagedata", { messageData });

// webdoc-hook
logger.info("Synced iCBTs", {
  bookingId: webdocIds.bookingId,
  visitId: webdocIds.visitId,
  patientUserId: patient.userId,
  typeId: icbts[0].typeId
});

// Errors
logger.error("Failed to sync iCBT", getErrorMessage(error), {
  typeId: icbts[0].typeId
});
```

---

## Testing

### Manual Testing (Development)

**1. Trigger program completion in indianapolis DynamoDB**:
```bash
# Update progress to completed
aws dynamodb update-item \
  --table-name Progress_indianapolis \
  --key '{"PK": {"S": "USER#123"}, "SK": {"S": "PROGRAM#abc-def"}}' \
  --update-expression "SET PageId = :lastPage, MaxProgressedPage = :lastPage" \
  --expression-attribute-values '{":lastPage": {"S": "page-final"}}'
```

**2. Send test message to webdoc-hook queue**:
```bash
aws sqs send-message \
  --queue-url http://localhost:9324/000000000000/WebdocIndianapolis.fifo \
  --message-group-id 123 \
  --message-deduplication-id test-123-abc \
  --message-body '{
    "userId": 123,
    "programId": "abc-def",
    "programTitle": "Test Program",
    "completedAt": "2025-01-06T10:00:00.000Z",
    "isAssigned": true,
    "free": false,
    "treatmentId": "treatment-123",
    "isStandalone": false,
    "uniqueIdentifier": "123-abc-def"
  }'
```

**3. Check DynamoDB mappings**:
```bash
aws dynamodb scan \
  --table-name WebdocMappings \
  --filter-expression "typeId = :typeId" \
  --expression-attribute-values '{":typeId": {"S": "icbt#patient#123"}}'
```

---

## Common Issues & Troubleshooting

### Issue: Program completed but not journaled

**Check**:
1. DynamoDB Progress table: `SentToJournal` field set to `true`?
2. SQS queue: Message in `WebdocIndianapolis.fifo` or DLQ?
3. CloudWatch Logs: Errors in indianapolis stream handler?

**Common causes**:
- Journal integration feature flag disabled
- Already journaled before (idempotent check)
- Program completed >30 days ago

### Issue: Duplicate journal entries

**Check**:
- `uniqueIdentifier` field should prevent duplicates
- DynamoDB mappings table for existing entry

**Fix**: SQS deduplication should prevent this, but if occurred:
```typescript
// Query for duplicates
const existing = await getIcbtByUniqueIdAndPatient(
  `icbt#patient#${userId}`,
  uniqueIdentifier
);
```

### Issue: iCBT not showing in Webdoc

**Check**:
1. DynamoDB mapping type: Should be `synced_icbt_patient` (not `icbt_patient`)
2. Webdoc API logs: Did journal entry creation succeed?
3. Patient mapping: Does Mindler patient ID map to Webdoc patient ID?

**Common causes**:
- Webdoc API authentication failure
- Patient not synced to Webdoc (SPAR sync issue)
- Incorrect psychologist ID

---

## Summary: Data Flow

```mermaid
graph TB
    A[Patient completes program<br/>in mobile/web app] --> B[DynamoDB Progress table updated<br/>PageId = lastPageId]
    B --> C[DynamoDB Stream event]
    C --> D[indianapolis Lambda triggered]
    D --> E{Program completed<br/>& not journaled?}
    E -->|No| Z[End]
    E -->|Yes| F[Query Contentful for<br/>program metadata]
    F --> G[Send message to<br/>WebdocIndianapolis.fifo SQS]
    G --> H[Update Progress table<br/>SentToJournal=true]
    H --> I[webdoc-hook Lambda triggered<br/>from SQS]
    I --> J[Query health-profiles<br/>Is assigned?]
    J --> K{Is assigned?}
    K -->|No| L[Schedule as<br/>non-assigned iCBT]
    K -->|Yes| M[Schedule iCBT with<br/>7-day spacing]
    L --> N[Daily cron job:<br/>syncIcbts]
    M --> N
    N --> O[Query DynamoDB for<br/>yesterday's scheduled iCBTs]
    O --> P[Check for visit collision]
    P --> Q{Same day as<br/>therapy session?}
    Q -->|Yes| R[Push to next day]
    Q -->|No| S[Get patient from MindlerDB]
    R --> S
    S --> T{Patient mapped<br/>in Webdoc?}
    T -->|No| U[Create Webdoc patient<br/>Save mapping]
    T -->|Yes| V[Create journal entries:<br/>Booking + Visit + Note]
    U --> V
    V --> W[Update DynamoDB:<br/>type=synced_icbt_patient]
    W --> X[Journal entry visible<br/>in Webdoc system]
    
    style B fill:#e1f5ff
    style G fill:#fff4e6
    style N fill:#f3e5f5
    style V fill:#c8e6c9
```

---

**Related Documentation**:
- [Service Communication Architecture](/docs/service-communication-architecture.md)
- [EventBridge Scheduler Guide](/docs/health-profiles-eventbridge-scheduler.md)
- [indianapolis Service README](/services/indianapolis/README.md)
- [webdoc-hook Service README](/services/webdoc-hook/README.md)
- [health-profiles Service README](/services/health-profiles/README.md)
