-- MySQL dump 10.13  Distrib 8.0.43, for macos15 (arm64)
--
-- Host: localhost    Database: mindler_paynbook_api
-- ------------------------------------------------------
-- Server version	8.0.39

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '';

--
-- Table structure for table `AgreementUrls`
--

DROP TABLE IF EXISTS `AgreementUrls`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AgreementUrls` (
  `agreementUrlId` int NOT NULL AUTO_INCREMENT,
  `agreementId` int NOT NULL,
  `languageId` int NOT NULL,
  `url` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`agreementUrlId`),
  KEY `agreementId` (`agreementId`),
  KEY `languageId` (`languageId`),
  CONSTRAINT `AgreementUrls_ibfk_1` FOREIGN KEY (`agreementId`) REFERENCES `Agreements` (`agreementId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `AgreementUrls_ibfk_2` FOREIGN KEY (`languageId`) REFERENCES `Languages` (`languageId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Agreements`
--

DROP TABLE IF EXISTS `Agreements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Agreements` (
  `agreementId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `version` int NOT NULL,
  `mandatoryLevel` enum('MUST_AGREE','MUST_ANSWER','OPTIONAL_ONCE','OPTIONAL_ALWAYS') COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'OPTIONAL_ALWAYS',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `countryId` int DEFAULT NULL,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`agreementId`),
  KEY `Agreements_countryId_foreign_idx` (`countryId`),
  CONSTRAINT `Agreements_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Answers`
--

DROP TABLE IF EXISTS `Answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Answers` (
  `answerId` int NOT NULL AUTO_INCREMENT,
  `answers` mediumtext COLLATE utf8mb3_unicode_ci,
  `type` enum('PRE_QUALIFICATION','POST_QUALIFICATION','EXERCISE_ANSWER','ICBT_FEE') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `patientId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `slotId` int DEFAULT NULL,
  PRIMARY KEY (`answerId`,`patientId`) USING BTREE,
  KEY `patientId` (`patientId`) USING BTREE,
  KEY `Answers_slotId_foreign_idx` (`slotId`) USING BTREE,
  CONSTRAINT `Answers_ibfk_1` FOREIGN KEY (`patientId`) REFERENCES `Patients` (`patientId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Answers_slotId_foreign_idx` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=4242 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `AppVersions`
--

DROP TABLE IF EXISTS `AppVersions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AppVersions` (
  `appVersionId` int NOT NULL AUTO_INCREMENT,
  `platform` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `version` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `forced` tinyint(1) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`appVersionId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `AuditLogs`
--

DROP TABLE IF EXISTS `AuditLogs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `AuditLogs` (
  `auditLogId` int NOT NULL AUTO_INCREMENT,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `referenceId` int NOT NULL,
  `referenceType` varchar(128) NOT NULL,
  `action` varchar(128) NOT NULL,
  `data` json DEFAULT NULL,
  `userId` int DEFAULT NULL,
  PRIMARY KEY (`auditLogId`),
  KEY `idx_referenceType_referenceId` (`referenceId`,`referenceType`)
) ENGINE=InnoDB AUTO_INCREMENT=277 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `B2BExercises`
--

DROP TABLE IF EXISTS `B2BExercises`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `B2BExercises` (
  `b2bExerciseId` int NOT NULL AUTO_INCREMENT,
  `exerciseId` int NOT NULL,
  `masterKeyId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`b2bExerciseId`),
  UNIQUE KEY `unique_exercise_id` (`exerciseId`),
  KEY `masterKeyId` (`masterKeyId`),
  CONSTRAINT `B2BExercises_ibfk_1` FOREIGN KEY (`exerciseId`) REFERENCES `Exercises` (`exerciseId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `B2BExercises_ibfk_2` FOREIGN KEY (`masterKeyId`) REFERENCES `MasterKeys` (`masterKeyId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=126 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `B2BMembershipPlans`
--

DROP TABLE IF EXISTS `B2BMembershipPlans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `B2BMembershipPlans` (
  `planId` int NOT NULL AUTO_INCREMENT,
  `planName` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `companyName` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `quota` int NOT NULL,
  `countryId` int NOT NULL,
  `quotaExtendable` tinyint(1) NOT NULL DEFAULT '0',
  `discount` decimal(3,2) DEFAULT NULL,
  `allowICBT` tinyint(1) NOT NULL DEFAULT '1',
  `allowVideo` tinyint(1) NOT NULL DEFAULT '1',
  `allowPhone` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`planId`),
  UNIQUE KEY `unique_composite_key` (`planName`,`companyName`),
  KEY `countryId` (`countryId`),
  CONSTRAINT `B2BMembershipPlans_ibfk_1` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `B2BPayments`
--

DROP TABLE IF EXISTS `B2BPayments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `B2BPayments` (
  `b2bPaymentId` int NOT NULL AUTO_INCREMENT,
  `paymentId` int NOT NULL,
  `masterKeyId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`b2bPaymentId`),
  UNIQUE KEY `unique_payment_id` (`paymentId`),
  KEY `masterKeyId` (`masterKeyId`),
  CONSTRAINT `B2BPayments_ibfk_1` FOREIGN KEY (`paymentId`) REFERENCES `Payments` (`paymentId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `B2BPayments_ibfk_2` FOREIGN KEY (`masterKeyId`) REFERENCES `MasterKeys` (`masterKeyId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=278 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `BillingRecords`
--

DROP TABLE IF EXISTS `BillingRecords`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BillingRecords` (
  `billingRecordId` int NOT NULL AUTO_INCREMENT,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `slotId` int NOT NULL,
  `submissionDate` date DEFAULT NULL,
  `remittanceDate` date DEFAULT NULL,
  `amount` int NOT NULL DEFAULT '0',
  `currency` varchar(64) DEFAULT NULL,
  `amountPaidByInsurer` int NOT NULL DEFAULT '0',
  `amountPaidByPatient` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`billingRecordId`),
  UNIQUE KEY `constraint_slotId` (`slotId`),
  CONSTRAINT `BillingRecords_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `BillogramPaymentContexts`
--

DROP TABLE IF EXISTS `BillogramPaymentContexts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BillogramPaymentContexts` (
  `billogramPaymentContextId` int NOT NULL AUTO_INCREMENT,
  `ocr` varchar(255) NOT NULL,
  `billogramId` varchar(255) NOT NULL,
  `receiptUrl` varchar(255) NOT NULL,
  `paymentId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`billogramPaymentContextId`),
  UNIQUE KEY `billogramId` (`billogramId`),
  KEY `paymentId` (`paymentId`),
  CONSTRAINT `BillogramPaymentContexts_ibfk_1` FOREIGN KEY (`paymentId`) REFERENCES `Payments` (`paymentId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=160 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `CacheEntries`
--

DROP TABLE IF EXISTS `CacheEntries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CacheEntries` (
  `key` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT '',
  `fieldName` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `data` mediumtext COLLATE utf8mb3_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`) USING BTREE,
  UNIQUE KEY `key` (`key`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ChatbotSessionMessages`
--

DROP TABLE IF EXISTS `ChatbotSessionMessages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ChatbotSessionMessages` (
  `chatbotSessionMessageId` int NOT NULL AUTO_INCREMENT,
  `chatbotSessionId` int NOT NULL,
  `message` text NOT NULL,
  `author` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publicId` varchar(36) DEFAULT NULL,
  `thumbsUp` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`chatbotSessionMessageId`),
  UNIQUE KEY `constraint_publicId` (`publicId`),
  KEY `ChatbotSessionMessages_chatbotSessionId_fkey` (`chatbotSessionId`),
  CONSTRAINT `ChatbotSessionMessages_chatbotSessionId_fkey` FOREIGN KEY (`chatbotSessionId`) REFERENCES `ChatbotSessions` (`chatbotSessionId`)
) ENGINE=InnoDB AUTO_INCREMENT=469 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ChatbotSessions`
--

DROP TABLE IF EXISTS `ChatbotSessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ChatbotSessions` (
  `chatbotSessionId` int NOT NULL AUTO_INCREMENT,
  `sessionId` varchar(36) NOT NULL,
  `userId` int DEFAULT NULL,
  `chatType` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`chatbotSessionId`),
  UNIQUE KEY `constraint_sessionId` (`sessionId`),
  KEY `ChatbotSessions_userId_fkey` (`userId`),
  KEY `ChatbotSessions_sessionId_idx` (`sessionId`),
  CONSTRAINT `ChatbotSessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`)
) ENGINE=InnoDB AUTO_INCREMENT=256 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ContentfulEnvironments`
--

DROP TABLE IF EXISTS `ContentfulEnvironments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ContentfulEnvironments` (
  `environmentId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `priority` int NOT NULL,
  PRIMARY KEY (`environmentId`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Countries`
--

DROP TABLE IF EXISTS `Countries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Countries` (
  `countryId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `codeISO2` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `codeISO3` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `defaultLanguageId` int DEFAULT NULL,
  PRIMARY KEY (`countryId`) USING BTREE,
  KEY `Countries_defaultLanguageId_foreign_idx` (`defaultLanguageId`),
  CONSTRAINT `Countries_defaultLanguageId_foreign_idx` FOREIGN KEY (`defaultLanguageId`) REFERENCES `Languages` (`languageId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `CountryLanguages`
--

DROP TABLE IF EXISTS `CountryLanguages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CountryLanguages` (
  `countryLanguageId` int NOT NULL AUTO_INCREMENT,
  `countryId` int NOT NULL,
  `languageId` int NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`countryLanguageId`,`countryId`,`languageId`),
  KEY `countryId` (`countryId`),
  KEY `languageId` (`languageId`),
  CONSTRAINT `CountryLanguages_ibfk_1` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `CountryLanguages_ibfk_2` FOREIGN KEY (`languageId`) REFERENCES `Languages` (`languageId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `CountryPrices`
--

DROP TABLE IF EXISTS `CountryPrices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CountryPrices` (
  `countryPriceId` int NOT NULL AUTO_INCREMENT,
  `countryId` int NOT NULL,
  `slotPrice` int NOT NULL,
  `currency` enum('SEK','DKK','NOK','EUR','USD','GBP') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `vat` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`countryPriceId`,`countryId`),
  KEY `countryId` (`countryId`),
  CONSTRAINT `CountryPrices_ibfk_1` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ExerciseHooks`
--

DROP TABLE IF EXISTS `ExerciseHooks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ExerciseHooks` (
  `exerciseHookId` int NOT NULL AUTO_INCREMENT,
  `response` text COLLATE utf8mb3_unicode_ci,
  `policy` enum('NO_RETRY','RETRY_1','RETRY_2','RETRY_3') COLLATE utf8mb3_unicode_ci DEFAULT 'RETRY_3',
  `lastSent` timestamp NULL DEFAULT NULL,
  `exerciseId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`exerciseHookId`,`exerciseId`),
  KEY `exerciseId` (`exerciseId`),
  CONSTRAINT `ExerciseHooks_ibfk_1` FOREIGN KEY (`exerciseId`) REFERENCES `Exercises` (`exerciseId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=1874 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Exercises`
--

DROP TABLE IF EXISTS `Exercises`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Exercises` (
  `exerciseId` int NOT NULL AUTO_INCREMENT,
  `cmsId` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `slug` mediumtext COLLATE utf8mb3_unicode_ci NOT NULL,
  `activated` tinyint(1) DEFAULT NULL,
  `completed` tinyint(1) DEFAULT NULL,
  `programmeId` int NOT NULL,
  `patientId` int NOT NULL,
  `psychologistId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `nrOfSteps` int NOT NULL,
  `progress` int NOT NULL DEFAULT '0',
  `completedAt` timestamp NULL DEFAULT NULL,
  `programmeUniqueId` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`exerciseId`) USING BTREE,
  KEY `programmeId` (`programmeId`) USING BTREE,
  KEY `patientId` (`patientId`) USING BTREE,
  KEY `psychologistId` (`psychologistId`) USING BTREE,
  KEY `exercises_completed` (`completed`),
  CONSTRAINT `Exercises_ibfk_1` FOREIGN KEY (`programmeId`) REFERENCES `Programmes` (`programmeId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Exercises_ibfk_2` FOREIGN KEY (`patientId`) REFERENCES `Patients` (`patientId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Exercises_ibfk_3` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2781 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ExternalIdentifiers`
--

DROP TABLE IF EXISTS `ExternalIdentifiers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ExternalIdentifiers` (
  `externalIdentifierId` int NOT NULL AUTO_INCREMENT,
  `userId` int DEFAULT NULL,
  `externalSystem` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `identifier` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `slotId` int DEFAULT NULL,
  `verified` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`externalIdentifierId`),
  KEY `userId` (`userId`),
  KEY `fk_external_identifiers_slot_id` (`slotId`),
  KEY `externalSystem_slotId` (`externalSystem`,`slotId`),
  KEY `externalSystem_userId` (`externalSystem`,`userId`),
  CONSTRAINT `ExternalIdentifiers_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_external_identifiers_slot_id` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Features`
--

DROP TABLE IF EXISTS `Features`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Features` (
  `featureId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `countryId` int DEFAULT NULL,
  `minAppVersion` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `userIds` json DEFAULT NULL,
  PRIMARY KEY (`featureId`),
  KEY `Features_countryId_foreign_idx` (`countryId`),
  CONSTRAINT `Features_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=110 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Hooks`
--

DROP TABLE IF EXISTS `Hooks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Hooks` (
  `hookId` int NOT NULL AUTO_INCREMENT,
  `response` mediumtext COLLATE utf8mb3_unicode_ci,
  `policy` enum('NO_RETRY','RETRY_1','RETRY_2','RETRY_3') COLLATE utf8mb3_unicode_ci DEFAULT 'RETRY_3',
  `lastSent` timestamp NULL DEFAULT NULL,
  `slotId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`hookId`,`slotId`) USING BTREE,
  KEY `Hooks_ibfk_1` (`slotId`) USING BTREE,
  CONSTRAINT `Hooks_ibfk_1` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=8353 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `IdentityChecks`
--

DROP TABLE IF EXISTS `IdentityChecks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `IdentityChecks` (
  `identityCheckId` int NOT NULL AUTO_INCREMENT,
  `checkerUserId` int NOT NULL,
  `checkedUserId` int NOT NULL,
  `comment` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`identityCheckId`),
  KEY `checkerUserId` (`checkerUserId`),
  KEY `checkedUserId` (`checkedUserId`),
  CONSTRAINT `IdentityChecks_ibfk_1` FOREIGN KEY (`checkerUserId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `IdentityChecks_ibfk_2` FOREIGN KEY (`checkedUserId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `InactiveUsers`
--

DROP TABLE IF EXISTS `InactiveUsers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `InactiveUsers` (
  `inactiveUserId` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `remindedAt` timestamp NULL DEFAULT NULL,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`inactiveUserId`),
  KEY `userId` (`userId`),
  CONSTRAINT `InactiveUsers_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2290 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `IndividualKeys`
--

DROP TABLE IF EXISTS `IndividualKeys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `IndividualKeys` (
  `individualKeyId` int NOT NULL AUTO_INCREMENT,
  `masterKeyId` int NOT NULL,
  `key` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `usage` int NOT NULL DEFAULT '0',
  `userId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`individualKeyId`) USING BTREE,
  UNIQUE KEY `key` (`key`) USING BTREE,
  KEY `masterKeyId` (`masterKeyId`) USING BTREE,
  KEY `userId` (`userId`) USING BTREE,
  CONSTRAINT `IndividualKeys_ibfk_1` FOREIGN KEY (`masterKeyId`) REFERENCES `MasterKeys` (`masterKeyId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `IndividualKeys_ibfk_2` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=365 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Languages`
--

DROP TABLE IF EXISTS `Languages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Languages` (
  `languageId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `codeISO2` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `codeISO3` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`languageId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `MasterKeyTypes`
--

DROP TABLE IF EXISTS `MasterKeyTypes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `MasterKeyTypes` (
  `masterKeyTypeId` int NOT NULL AUTO_INCREMENT,
  `masterKeyId` int NOT NULL,
  `masterKeyType` enum('VIDEO','ICBT','PHONE') COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`masterKeyTypeId`),
  UNIQUE KEY `master_key_id_to_master_key_type` (`masterKeyId`,`masterKeyType`),
  CONSTRAINT `MasterKeyTypes_ibfk_1` FOREIGN KEY (`masterKeyId`) REFERENCES `MasterKeys` (`masterKeyId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=955 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `MasterKeys`
--

DROP TABLE IF EXISTS `MasterKeys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `MasterKeys` (
  `masterKeyId` int NOT NULL AUTO_INCREMENT,
  `category` enum('B2B','BUNDLE','CS','INTERNAL','MARKETING','OTHER','TBD','B2B_MEMBERSHIP') COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'TBD',
  `companyName` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `key` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `quota` int DEFAULT NULL,
  `discount` decimal(3,2) DEFAULT '1.00',
  `expiration` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedBy` int DEFAULT NULL,
  `type` enum('MindlerPay','CompanyPay') COLLATE utf8mb3_unicode_ci NOT NULL,
  `numOfIndividualKeys` int NOT NULL,
  `emailPattern` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `startDate` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `owner` int DEFAULT NULL,
  `countryId` int DEFAULT NULL,
  `deletedAt` timestamp NULL DEFAULT NULL,
  `b2bMembershipPlanId` int DEFAULT NULL,
  PRIMARY KEY (`masterKeyId`) USING BTREE,
  KEY `MasterKeys_owner_foreign_idx` (`owner`),
  KEY `MasterKeys_countryId_foreign_idx` (`countryId`),
  KEY `MasterKeys_updatedBy_foreign_idx` (`updatedBy`),
  KEY `MasterKeys_b2bMembershipPlanId_foreign_idx` (`b2bMembershipPlanId`),
  CONSTRAINT `MasterKeys_b2bMembershipPlanId_foreign_idx` FOREIGN KEY (`b2bMembershipPlanId`) REFERENCES `B2BMembershipPlans` (`planId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `MasterKeys_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `MasterKeys_owner_foreign_idx` FOREIGN KEY (`owner`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `MasterKeys_updatedBy_foreign_idx` FOREIGN KEY (`updatedBy`) REFERENCES `Users` (`userId`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=480 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `OneTimeUserMessages`
--

DROP TABLE IF EXISTS `OneTimeUserMessages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `OneTimeUserMessages` (
  `oneTimeUserMessageId` int NOT NULL AUTO_INCREMENT,
  `type` enum('FIRST_COMPLETED_MEETING','ICBT_UNLOCKED','48H_NOBOOKING','WELCOME_EMAIL') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`oneTimeUserMessageId`),
  KEY `userId` (`userId`),
  CONSTRAINT `OneTimeUserMessages_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=507 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Patients`
--

DROP TABLE IF EXISTS `Patients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Patients` (
  `patientId` int NOT NULL AUTO_INCREMENT,
  `freeCardNumber` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `freeCardExpiryDate` timestamp NULL DEFAULT NULL,
  `termsAndConditions` tinyint(1) DEFAULT '0',
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `phoneNumber` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`patientId`) USING BTREE,
  UNIQUE KEY `userId` (`userId`) USING BTREE,
  CONSTRAINT `Patients_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=5301 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PaymentInvoiceContexts`
--

DROP TABLE IF EXISTS `PaymentInvoiceContexts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PaymentInvoiceContexts` (
  `paymentInvoiceContextId` int NOT NULL AUTO_INCREMENT,
  `externalId` varchar(512) DEFAULT NULL,
  `paymentUrl` varchar(1024) DEFAULT NULL,
  `paymentId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`paymentInvoiceContextId`),
  UNIQUE KEY `PaymentInvoiceContexts_paymentId_key` (`paymentId`),
  CONSTRAINT `PaymentInvoiceContexts_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payments` (`paymentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PaymentLogs`
--

DROP TABLE IF EXISTS `PaymentLogs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PaymentLogs` (
  `paymentLogId` int NOT NULL AUTO_INCREMENT,
  `reference` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `action` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `amount` int DEFAULT NULL,
  `vat` int DEFAULT NULL,
  `currency` enum('SEK','DKK','NOK','EUR','USD','GBP') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `comment` mediumtext COLLATE utf8mb3_unicode_ci,
  `paymentId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`paymentLogId`,`paymentId`) USING BTREE,
  KEY `paymentId` (`paymentId`) USING BTREE,
  CONSTRAINT `PaymentLogs_ibfk_1` FOREIGN KEY (`paymentId`) REFERENCES `Payments` (`paymentId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=7163 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PaymentMethods`
--

DROP TABLE IF EXISTS `PaymentMethods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PaymentMethods` (
  `paymentMethodId` int NOT NULL AUTO_INCREMENT,
  `type` enum('CreditCard','Swish','FreeCard','B2B','NoPayment','MindlerForYouth','MindlerForElderly','Invoice') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `allowDiscount` tinyint(1) DEFAULT '0',
  `provider` enum('PAYEX','STRIPE','BILLOGRAM') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `order` int DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `countryId` int DEFAULT NULL,
  PRIMARY KEY (`paymentMethodId`) USING BTREE,
  KEY `PaymentMethods_countryId_foreign_idx` (`countryId`) USING BTREE,
  CONSTRAINT `PaymentMethods_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Payments`
--

DROP TABLE IF EXISTS `Payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Payments` (
  `paymentId` int NOT NULL AUTO_INCREMENT,
  `pspId` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `status` enum('INITIALIZED','AUTHORIZATION','AUTHORIZATION_FAILED','AUTHORIZATION_REVERSED','CAPTURE','SALE','REFUND','CANCELED','PARTIAL_REFUND') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `amount` int DEFAULT NULL,
  `vat` int DEFAULT NULL,
  `currency` enum('SEK','DKK','NOK','EUR','USD','GBP') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `slotId` int NOT NULL,
  `patientId` int NOT NULL,
  `type` enum('CreditCard','Swish','FreeCard','B2B','NoPayment','MindlerForYouth','MindlerForElderly','Invoice') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `provider` enum('PAYEX','STRIPE','BILLOGRAM') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `payedAmount` int DEFAULT NULL,
  `countryId` int DEFAULT NULL,
  `category` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`paymentId`,`slotId`,`patientId`) USING BTREE,
  UNIQUE KEY `pspId` (`pspId`) USING BTREE,
  KEY `slotId` (`slotId`) USING BTREE,
  KEY `patientId` (`patientId`) USING BTREE,
  KEY `Payments_countryId_foreign_idx` (`countryId`),
  CONSTRAINT `Payments_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `Payments_ibfk_1` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Payments_ibfk_2` FOREIGN KEY (`patientId`) REFERENCES `Patients` (`patientId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=27646 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Permissions`
--

DROP TABLE IF EXISTS `Permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Permissions` (
  `userId` int NOT NULL,
  `feature` varchar(255) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`,`feature`),
  CONSTRAINT `Permissions_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Programmes`
--

DROP TABLE IF EXISTS `Programmes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Programmes` (
  `programmeId` int NOT NULL AUTO_INCREMENT,
  `hash` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `programme` mediumtext COLLATE utf8mb3_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `slug` text COLLATE utf8mb3_unicode_ci,
  `countryId` int DEFAULT NULL,
  `languageId` int DEFAULT NULL,
  `programmeUniqueId` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `free` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`programmeId`) USING BTREE,
  UNIQUE KEY `hash` (`hash`) USING BTREE,
  KEY `Programmes_countryId_foreign_idx` (`countryId`),
  KEY `Programmes_languageId_foreign_idx` (`languageId`),
  CONSTRAINT `Programmes_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `Programmes_languageId_foreign_idx` FOREIGN KEY (`languageId`) REFERENCES `Languages` (`languageId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=311 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PsychologistComments`
--

DROP TABLE IF EXISTS `PsychologistComments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PsychologistComments` (
  `psychologistCommentId` int NOT NULL AUTO_INCREMENT,
  `psychologistId` int NOT NULL,
  `countryLanguageId` int NOT NULL,
  `comment` text COLLATE utf8mb3_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`psychologistCommentId`),
  KEY `psychologistId` (`psychologistId`),
  KEY `countryLanguageId` (`countryLanguageId`),
  CONSTRAINT `PsychologistComments_ibfk_1` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `PsychologistComments_ibfk_2` FOREIGN KEY (`countryLanguageId`) REFERENCES `CountryLanguages` (`countryLanguageId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=117 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PsychologistCountries`
--

DROP TABLE IF EXISTS `PsychologistCountries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PsychologistCountries` (
  `psychologistCountryId` int NOT NULL AUTO_INCREMENT,
  `countryId` int NOT NULL,
  `psychologistId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`psychologistCountryId`),
  KEY `countryId` (`countryId`),
  KEY `psychologistId` (`psychologistId`),
  CONSTRAINT `PsychologistCountries_ibfk_1` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `PsychologistCountries_ibfk_2` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=4620 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PsychologistDescriptions`
--

DROP TABLE IF EXISTS `PsychologistDescriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PsychologistDescriptions` (
  `psychologistDescriptionId` int NOT NULL AUTO_INCREMENT,
  `psychologistId` int NOT NULL,
  `countryLanguageId` int NOT NULL,
  `description` text COLLATE utf8mb3_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`psychologistDescriptionId`),
  KEY `psychologistId` (`psychologistId`),
  KEY `countryLanguageId` (`countryLanguageId`),
  CONSTRAINT `PsychologistDescriptions_ibfk_1` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `PsychologistDescriptions_ibfk_2` FOREIGN KEY (`countryLanguageId`) REFERENCES `CountryLanguages` (`countryLanguageId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2529 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PsychologistLanguages`
--

DROP TABLE IF EXISTS `PsychologistLanguages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PsychologistLanguages` (
  `psychologistId` int NOT NULL,
  `languageId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`psychologistId`,`languageId`) USING BTREE,
  KEY `languageId` (`languageId`) USING BTREE,
  CONSTRAINT `PsychologistLanguages_ibfk_1` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `PsychologistLanguages_ibfk_2` FOREIGN KEY (`languageId`) REFERENCES `Languages` (`languageId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `PsychologistSpecialities`
--

DROP TABLE IF EXISTS `PsychologistSpecialities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PsychologistSpecialities` (
  `psychologistId` int NOT NULL,
  `specialityId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`psychologistId`,`specialityId`) USING BTREE,
  KEY `specialityId` (`specialityId`) USING BTREE,
  CONSTRAINT `PsychologistSpecialities_ibfk_1` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `PsychologistSpecialities_ibfk_2` FOREIGN KEY (`specialityId`) REFERENCES `Specialities` (`specialityId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Psychologists`
--

DROP TABLE IF EXISTS `Psychologists`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Psychologists` (
  `psychologistId` int NOT NULL AUTO_INCREMENT,
  `gender` enum('M','F','O') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `headline` varchar(500) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `summary` mediumtext COLLATE utf8mb3_unicode_ci,
  `thumbnail` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `bigImage` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `phone` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `hsa` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `inactive` tinyint(1) NOT NULL DEFAULT '0',
  `headlineEnum` enum('cbt_default','cbt_phd','cbt_addiction','cbt_occupational','counselling','clinical_health','applied','lead','clinical','basic','gz','psychotherapist','licensed','authorised') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `employmentType` varchar(128) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `location` varchar(128) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `absenceStatus` varchar(128) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`psychologistId`) USING BTREE,
  UNIQUE KEY `userId` (`userId`) USING BTREE,
  CONSTRAINT `Psychologists_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=4565 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Receipts`
--

DROP TABLE IF EXISTS `Receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Receipts` (
  `receiptId` int NOT NULL AUTO_INCREMENT,
  `s3Bucket` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `s3Key` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `slotId` int NOT NULL,
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `checksum` varchar(40) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`receiptId`),
  KEY `slotId` (`slotId`),
  KEY `userId` (`userId`),
  CONSTRAINT `Receipts_ibfk_1` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Receipts_ibfk_2` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=252 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Referrals`
--

DROP TABLE IF EXISTS `Referrals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Referrals` (
  `referralId` int NOT NULL AUTO_INCREMENT,
  `patientId` int NOT NULL,
  `referralExpiryDate` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`referralId`),
  KEY `patientId` (`patientId`),
  CONSTRAINT `Referrals_ibfk_1` FOREIGN KEY (`patientId`) REFERENCES `Patients` (`patientId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `RegistrationTokens`
--

DROP TABLE IF EXISTS `RegistrationTokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `RegistrationTokens` (
  `nationalIdentity` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT '',
  `rolesBit` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `email` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `createdBy` int DEFAULT NULL,
  `isDeleted` tinyint(1) NOT NULL DEFAULT '0',
  `registrationTokenId` int NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`nationalIdentity`) USING BTREE,
  UNIQUE KEY `nationalIdentity` (`nationalIdentity`) USING BTREE,
  UNIQUE KEY `registrationTokenId` (`registrationTokenId`),
  UNIQUE KEY `encrypted_email` (`email`),
  KEY `RegistrationTokens_createdBy_foreign_idx` (`createdBy`),
  CONSTRAINT `RegistrationTokens_createdBy_foreign_idx` FOREIGN KEY (`createdBy`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=177 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `RegistrationtokenCountries`
--

DROP TABLE IF EXISTS `RegistrationtokenCountries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `RegistrationtokenCountries` (
  `registrationtokenCountryId` int NOT NULL AUTO_INCREMENT,
  `countryId` int NOT NULL,
  `registrationTokenId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`registrationtokenCountryId`),
  KEY `countryId` (`countryId`),
  KEY `registrationTokenId` (`registrationTokenId`),
  CONSTRAINT `RegistrationtokenCountries_ibfk_1` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `RegistrationtokenCountries_ibfk_2` FOREIGN KEY (`registrationTokenId`) REFERENCES `RegistrationTokens` (`registrationTokenId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=173 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Reminders`
--

DROP TABLE IF EXISTS `Reminders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Reminders` (
  `reminderId` int NOT NULL AUTO_INCREMENT,
  `type` enum('MEETING_SOON','MEETING_TOMORROW','UNPAID_SOON','UNPAID_TOMORROW','MEETING_STARTED','MEETING_TOMORROW_OR_WITHIN_TWO_HOURS','UNPAID_WITH_START_AFTER_TOMORROW') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `slotId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`reminderId`) USING BTREE,
  KEY `slotId` (`slotId`) USING BTREE,
  CONSTRAINT `Reminders_ibfk_1` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=5131 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Roles`
--

DROP TABLE IF EXISTS `Roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Roles` (
  `roleId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `bit` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`roleId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `SequelizeData`
--

DROP TABLE IF EXISTS `SequelizeData`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SequelizeData` (
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  PRIMARY KEY (`name`) USING BTREE,
  UNIQUE KEY `name` (`name`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `SequelizeMeta`
--

DROP TABLE IF EXISTS `SequelizeMeta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SequelizeMeta` (
  `name` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  PRIMARY KEY (`name`) USING BTREE,
  UNIQUE KEY `name` (`name`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `SlotParticipants`
--

DROP TABLE IF EXISTS `SlotParticipants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SlotParticipants` (
  `slotParticipantId` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `slotId` int NOT NULL,
  `connectedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `videoTypeId` tinyint DEFAULT NULL,
  PRIMARY KEY (`slotParticipantId`),
  KEY `userId` (`userId`),
  KEY `slotId` (`slotId`),
  CONSTRAINT `SlotParticipants_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `SlotParticipants_ibfk_2` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=35710 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Slots`
--

DROP TABLE IF EXISTS `Slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Slots` (
  `slotId` int NOT NULL AUTO_INCREMENT,
  `startsAt` timestamp NOT NULL DEFAULT '2000-01-01 00:00:00',
  `endsAt` timestamp NOT NULL DEFAULT '2000-01-01 00:00:00',
  `payed` tinyint(1) DEFAULT '0',
  `status` enum('OPEN','BOOKED','UNAVAILABLE','CANCELED','LATE_CANCELED','NO_SHOW','ORGANIZER_NO_SHOW','NO_SHOW_ALL') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `method` enum('VIDEO','CHAT','PHONE') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `patientId` int DEFAULT NULL,
  `psychologistId` int NOT NULL,
  `templateId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `bookingName` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `bookedAt` timestamp NULL DEFAULT NULL,
  `lastManualEditAt` timestamp NULL DEFAULT NULL,
  `feeWaived` tinyint(1) DEFAULT '0',
  `canceledAt` timestamp NULL DEFAULT NULL,
  `canceledBy` int DEFAULT NULL,
  `originalTemplateId` int DEFAULT NULL,
  PRIMARY KEY (`slotId`) USING BTREE,
  KEY `patientId` (`patientId`) USING BTREE,
  KEY `psychologistId` (`psychologistId`) USING BTREE,
  KEY `templateId` (`templateId`) USING BTREE,
  KEY `startsAt` (`startsAt`),
  KEY `Slots_canceledBy_foreign_idx` (`canceledBy`),
  CONSTRAINT `Slots_canceledBy_foreign_idx` FOREIGN KEY (`canceledBy`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `Slots_ibfk_1` FOREIGN KEY (`patientId`) REFERENCES `Patients` (`patientId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Slots_ibfk_2` FOREIGN KEY (`psychologistId`) REFERENCES `Psychologists` (`psychologistId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Slots_ibfk_3` FOREIGN KEY (`templateId`) REFERENCES `Templates` (`templateId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=36657 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Specialities`
--

DROP TABLE IF EXISTS `Specialities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Specialities` (
  `specialityId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `description` mediumtext COLLATE utf8mb3_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `enum` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`specialityId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Templates`
--

DROP TABLE IF EXISTS `Templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Templates` (
  `templateId` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `defaultLength` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `allowParallel` tinyint(1) NOT NULL DEFAULT '0',
  `allowCustomLength` tinyint(1) NOT NULL DEFAULT '0',
  `allowInPast` tinyint(1) NOT NULL DEFAULT '0',
  `isMeeting` tinyint(1) NOT NULL DEFAULT '1',
  `allowNameChange` tinyint(1) NOT NULL DEFAULT '0',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`templateId`) USING BTREE,
  UNIQUE KEY `UC_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `TreatmentEvents`
--

DROP TABLE IF EXISTS `TreatmentEvents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TreatmentEvents` (
  `treatmentEventId` int NOT NULL AUTO_INCREMENT,
  `patientUserId` int NOT NULL,
  `triggeredByUserId` int DEFAULT NULL,
  `endTreatmentReason` enum('TREATMENT_COMPLETED','DOES_NOT_COMPLY_WITH_USER_AGREEMENTS','SEVERAL_MISSED_VISITS','DID_NOT_MEET_CARE_CRITERIA','END_ON_PATIENTS_REQUEST','PATIENT_REFERRED_TO_EXTERNAL_CARE','REFERRED_TO_COLLEAGUE','TREATMENT_NOT_APPLICABLE') COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `type` enum('TREATMENT_START','TREATMENT_END') COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`treatmentEventId`),
  KEY `patientUserId` (`patientUserId`),
  KEY `triggeredByUserId` (`triggeredByUserId`),
  CONSTRAINT `TreatmentEvents_ibfk_1` FOREIGN KEY (`patientUserId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `TreatmentEvents_ibfk_2` FOREIGN KEY (`triggeredByUserId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=1558 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `TreatmentStatus`
--

DROP TABLE IF EXISTS `TreatmentStatus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `TreatmentStatus` (
  `patientUserId` int NOT NULL,
  `treatmentEventId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`patientUserId`),
  KEY `treatmentEventId` (`treatmentEventId`),
  CONSTRAINT `TreatmentStatus_ibfk_1` FOREIGN KEY (`patientUserId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `TreatmentStatus_ibfk_2` FOREIGN KEY (`treatmentEventId`) REFERENCES `TreatmentEvents` (`treatmentEventId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserAgreements`
--

DROP TABLE IF EXISTS `UserAgreements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserAgreements` (
  `userAgreementId` int NOT NULL AUTO_INCREMENT,
  `agreementId` int NOT NULL,
  `userId` int NOT NULL,
  `version` int NOT NULL,
  `haveAccepted` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`userAgreementId`),
  UNIQUE KEY `user_agreement` (`userId`,`agreementId`),
  KEY `agreementId` (`agreementId`),
  CONSTRAINT `UserAgreements_ibfk_1` FOREIGN KEY (`agreementId`) REFERENCES `Agreements` (`agreementId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `UserAgreements_ibfk_2` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=7320 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserAgreementsHistory`
--

DROP TABLE IF EXISTS `UserAgreementsHistory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserAgreementsHistory` (
  `userAgreementHistoryId` int NOT NULL AUTO_INCREMENT,
  `agreementId` int NOT NULL,
  `userId` int NOT NULL,
  `version` int NOT NULL,
  `haveAccepted` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userAgreementHistoryId`),
  KEY `agreementId` (`agreementId`),
  KEY `userId` (`userId`),
  CONSTRAINT `UserAgreementsHistory_ibfk_1` FOREIGN KEY (`agreementId`) REFERENCES `Agreements` (`agreementId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `UserAgreementsHistory_ibfk_2` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=994 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserAttributes`
--

DROP TABLE IF EXISTS `UserAttributes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserAttributes` (
  `userId` int NOT NULL,
  `attribute` enum('DATE_OF_BIRTH','ADDRESS','POSTAL_CODE','CITY','COUNTRY','SE_PRIMARY_CLINIC','SE_CLINIC_REGION','SE_REGION') COLLATE utf8mb3_unicode_ci NOT NULL,
  `value` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`,`attribute`),
  CONSTRAINT `UserAttributes_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserBlockLogs`
--

DROP TABLE IF EXISTS `UserBlockLogs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserBlockLogs` (
  `userBlockLogId` int NOT NULL AUTO_INCREMENT,
  `issuerUserId` int NOT NULL,
  `blockedUserId` int NOT NULL,
  `reason` varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `action` enum('BLOCKED','UNBLOCKED') COLLATE utf8mb3_unicode_ci NOT NULL,
  PRIMARY KEY (`userBlockLogId`),
  KEY `issuerUserId` (`issuerUserId`),
  KEY `blockedUserId` (`blockedUserId`),
  CONSTRAINT `UserBlockLogs_ibfk_1` FOREIGN KEY (`issuerUserId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `UserBlockLogs_ibfk_2` FOREIGN KEY (`blockedUserId`) REFERENCES `Users` (`userId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserIdentities`
--

DROP TABLE IF EXISTS `UserIdentities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserIdentities` (
  `userIdentitiesId` int NOT NULL AUTO_INCREMENT,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSignInAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `identity` varchar(128) NOT NULL,
  `subjectId` varchar(256) NOT NULL,
  `userId` int NOT NULL,
  PRIMARY KEY (`userIdentitiesId`),
  UNIQUE KEY `constraint_provider_issuer_user_id` (`identity`,`userId`),
  UNIQUE KEY `constraint_provider_provider_subject_id_issuer` (`identity`,`subjectId`),
  KEY `idx_identity_subject_id` (`identity`,`subjectId`),
  KEY `idx_user_id` (`userId`),
  CONSTRAINT `UserAuthenticationProviders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserRoles`
--

DROP TABLE IF EXISTS `UserRoles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserRoles` (
  `userId` int NOT NULL,
  `roleId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`,`roleId`) USING BTREE,
  KEY `roleId` (`roleId`) USING BTREE,
  CONSTRAINT `UserRoles_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `UserRoles_ibfk_2` FOREIGN KEY (`roleId`) REFERENCES `Roles` (`roleId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UserSettings`
--

DROP TABLE IF EXISTS `UserSettings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `UserSettings` (
  `userSettingId` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `settingKey` enum('PREVIEW_ALL_PROGRAMS','RECEIVE_ICBT_FEEDBACK_DATE') COLLATE utf8mb3_unicode_ci NOT NULL,
  `value` tinyint(1) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`userSettingId`),
  KEY `userId` (`userId`),
  CONSTRAINT `UserSettings_ibfk_1` FOREIGN KEY (`userId`) REFERENCES `Users` (`userId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Users`
--

DROP TABLE IF EXISTS `Users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Users` (
  `userId` int NOT NULL AUTO_INCREMENT,
  `nationalIdentity` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `blocked` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notificationToken` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `languageId` int DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL,
  `countryId` int DEFAULT NULL,
  `firstName` text COLLATE utf8mb3_unicode_ci,
  `lastName` text COLLATE utf8mb3_unicode_ci,
  `firstNameLowercase` text COLLATE utf8mb3_unicode_ci,
  `lastNameLowercase` text COLLATE utf8mb3_unicode_ci,
  `emailChangedAt` timestamp NULL DEFAULT NULL,
  `isEmailVerified` tinyint(1) NOT NULL DEFAULT '0',
  `deletedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`userId`) USING BTREE,
  UNIQUE KEY `nationalIdentity` (`nationalIdentity`) USING BTREE,
  UNIQUE KEY `encrypted_email` (`email`),
  KEY `Users_languageId_foreign_idx` (`languageId`) USING BTREE,
  KEY `Users_countryId_foreign_idx` (`countryId`),
  KEY `users_deleted_at` (`deletedAt`),
  CONSTRAINT `Users_countryId_foreign_idx` FOREIGN KEY (`countryId`) REFERENCES `Countries` (`countryId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `Users_languageId_foreign_idx` FOREIGN KEY (`languageId`) REFERENCES `Languages` (`languageId`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=10675 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `VonageSessions`
--

DROP TABLE IF EXISTS `VonageSessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `VonageSessions` (
  `vonageSessionId` int NOT NULL AUTO_INCREMENT,
  `sessionId` varchar(255) NOT NULL,
  `slotId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`vonageSessionId`),
  UNIQUE KEY `sessionId` (`sessionId`),
  UNIQUE KEY `slotId` (`slotId`),
  CONSTRAINT `VonageSessions_ibfk_1` FOREIGN KEY (`slotId`) REFERENCES `Slots` (`slotId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=382 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kysely_migration`
--

DROP TABLE IF EXISTS `kysely_migration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kysely_migration` (
  `name` varchar(255) NOT NULL,
  `timestamp` varchar(255) NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kysely_migration_lock`
--

DROP TABLE IF EXISTS `kysely_migration_lock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kysely_migration_lock` (
  `id` varchar(255) NOT NULL,
  `is_locked` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-07 10:08:13
