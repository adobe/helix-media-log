# Helix Media Log - Project Overview

## 1. Purpose

The **Helix Media Log** is an AWS Lambda-based service that collects, processes, and stores media activity notifications for Adobe Helix projects. It tracks whenever media items (images, videos, documents, etc.) are added, updated, or deleted in the Helix MediaBus system, persisting these events to S3 storage in a structured, compressed format.

## 2. High-Level Architecture

```
┌─────────────────────────┐
│  MediaBus / Services    │
│  (Media Events)         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   SQS Input Queue       │
│  (helix-media-log)      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  AWS EventBridge        │
│  (Triggers every 1 min) │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Lambda Function        │
│  (events.js handler)    │
│  - Batches messages     │
│  - Groups by org/site   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   SQS Output Queue      │
│ (helix-media-log.fifo)  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Lambda Function        │
│  (trigger.js handler)   │
│  - Processes updates    │
│  - Writes to S3         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   S3 Bucket             │
│  (helix-media-logs)     │
│  org/site/*.gz files    │
└─────────────────────────┘
```

## 3. Core Workflow

### Phase 1: Message Collection (events.js)

**Trigger**: AWS EventBridge CloudWatch Events (every 1 minute)

1. **Polling**: Lambda polls the input SQS queue (`helix-media-log`)
2. **Batching**: Retrieves up to 50 messages with a max processing time of 30 seconds
3. **Parsing**: Handles both SNS and SQS message formats
4. **Grouping**: Groups messages by project key (`org/site`)
5. **Special Handling**: 
   - If an org is in `HLX_MEDIA_LOGGING_ORGS`, also creates a separate entry for `org/*` (organization-level logging)
   - Supports legacy format: `owner/repo` (mapped to `org/site`)
6. **Forwarding**: Sends batched messages to the FIFO output queue
7. **Cleanup**: Deletes processed messages from input queue

### Phase 2: Log Writing (trigger.js)

**Trigger**: SQS event (from output queue)

1. **Message Processing**: Receives batched messages for a specific org/site
2. **Large Message Handling**: If message was too large for SQS, retrieves from S3 (`swapS3Url`)
3. **Media Log Writing**: 
   - Uses custom `MediaLog` class to write to S3
   - Appends updates to the appropriate log file
4. **S3 Storage**: Updates are written to compressed `.gz` files
5. **Cleanup**: Deletes temporary S3 objects if message was swapped out

## 4. Component Details

### 4.1 Main Entry Point (`src/index.js`)

The Lambda handler that routes requests based on the invocation source:

```javascript
- If source === 'aws.events' → calls events.js (scheduled polling)
- If records exist → calls trigger.js (SQS trigger)
- If POST with JSON → manual testing mode
- Otherwise → 400 Bad Request
```

**Middleware Stack**:
- `bodyData`: Parses request bodies
- `secrets`: Loads secrets from AWS Secrets Manager
- `helixStatus`: Provides health check endpoint

### 4.2 Event Poller (`src/events.js`)

**Key Functions**:
- `getInputQueue()`: Returns SQS input queue URL
- `getOutputQueue()`: Returns SQS FIFO output queue URL
- `getLoggingOrgs()`: Reads `HLX_MEDIA_LOGGING_ORGS` env variable
- `doRun()`: Main processing logic

**Message Format**:
```json
{
  "org": "organization-name",
  "site": "site-name",
  "owner": "owner-name",  // legacy
  "repo": "repo-name",    // legacy
  "ref": "branch-name",
  "result": {
    "timestamp": 1705320000000,
    "mediaId": "abc123",
    "action": "add|update|delete",
    "path": "/path/to/media.jpg",
    "mimeType": "image/jpeg",
    "size": 123456,
    "user": "user@example.com",
    // ... additional media metadata
  }
}
```

**Batching Strategy**:
- Uses `BatchedQueueClient` from `@adobe/helix-admin-support`
- Groups messages by project key (`org/site`)
- Automatically swaps large payloads to S3 if needed
- Uses FIFO queue with `MessageGroupId` to maintain order per project

### 4.3 Trigger Handler (`src/trigger.js`)

**Key Functions**:
- `processMessage()`: Processes individual SQS messages
- `processUpdates()`: Writes media events to S3
- `deserialize()`: Retrieves large messages from S3
- `s3InputFromURL()`: Parses S3 URLs

**Batch Processing**:
- Processes messages one at a time (batch size = 1 recommended)
- Returns `batchItemFailures` for failed messages (SQS retry)
- Each message contains updates for a single org/site combination

### 4.4 S3 Media Log (`src/s3/MediaLog.js`)

**Storage Structure**:
```
helix-media-logs/
├── org1/
│   ├── site1/
│   │   ├── .index                          # List of log files
│   │   ├── 2024-01-15-10-30-45-ABC123.gz  # Compressed media log
│   │   └── 2024-01-15-12-00-00-DEF456.gz
│   └── site2/
│       └── ...
└── org2/
    └── ...
```

**Log File Management**:
- `.index` file contains newline-separated list of log files in chronological order
- Each log file is a gzipped JSON array
- Max file size: 512KB (uncompressed)
- When max size reached, creates new log file
- Metadata includes `last-event-time` for the most recent event

**DateFormat** (`src/s3/DateFormat.js`):
- Custom date format: `YYYY-MM-DD-HH-mm-ss` (with `-` instead of `T` and `:`)
- Example: `2024-01-15-10-30-45`

### 4.5 Organization-Level Logging

If an organization is listed in `HLX_MEDIA_LOGGING_ORGS` environment variable:
- Creates two log entries for each event:
  1. `org/site` - site-specific log
  2. `org/*` - organization-wide aggregate log

**Example**:
```json
// HLX_MEDIA_LOGGING_ORGS = ["adobe", "microsoft"]
// Event for adobe/example-site creates logs in:
// - helix-media-logs/adobe/example-site/
// - helix-media-logs/adobe/*/
```

## 5. AWS Services Used

### 5.1 Lambda Function
- **Runtime**: Node.js 22
- **Memory**: 1024 MB
- **Timeout**: 5 minutes (300 seconds)
- **IAM Role**: `arn:aws:iam::118435662149:role/helix-service-role-s3-rw`
- **Authorizer**: `helix-token-authorizer_v2`

### 5.2 SQS Queues
- **Input Queue**: `helix-media-log` (standard queue)
- **Output Queue**: `helix-media-log.fifo` (FIFO queue)
- Both queues auto-created based on AWS region and account ID

### 5.3 EventBridge (CloudWatch Events)
- **Rule**: Triggers every 1 minute
- **Target**: Lambda function
- **Purpose**: Polls input queue for new messages

### 5.4 S3 Bucket
- **Bucket**: `helix-media-logs`
- **Purpose**: Stores compressed media logs
- **Format**: Gzipped JSON files

### 5.5 AWS Secrets Manager
- Used by `@adobe/helix-shared-secrets` middleware
- Stores sensitive configuration

## 6. Deployment

### 6.1 Deployment Tool
Uses `@adobe/helix-deploy` (hedy) for deployment:
```bash
npm run build          # Build and validate
npm run deploy         # Deploy with tests
npm run deploy-ci      # CI deployment
```

### 6.2 Deployment Configuration (`package.json`)
```json
{
  "wsk": {
    "nodeVersion": 22,
    "name": "helix3/media-log@${version}",
    "memory": 1024,
    "timeout": "300000",
    "awsRole": "arn:aws:iam::118435662149:role/helix-service-role-s3-rw",
    "testUrl": "/_status_check/healthcheck.json",
    "awsAttachAuthorizer": "helix-token-authorizer_v2",
    "target": "aws"
  }
}
```

### 6.3 Post-Deployment Setup

**Step 1: Create EventBridge Rule**
```bash
aws events put-rule --name media-log-every-minute --schedule-expression "rate(1 minute)"
```

**Step 2: Grant Permissions**
```bash
AWS_REGION=...; AWS_ACCOUNT_ID=...; aws lambda add-permission \
  --statement-id "rule-media-log-every-minute" \
  --function-name "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1" \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/media-log-every-minute"
```

**Step 3: Add Lambda as Target**
```bash
AWS_REGION=...; AWS_ACCOUNT_ID=...; aws events put-targets \
  --rule media-log-every-minute \
  --targets "Id"="1","Arn"="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1"
```

**Step 4: Create SQS Queues**
```bash
# Create input queue
aws sqs create-queue --queue-name helix-media-log

# Create FIFO output queue
aws sqs create-queue --queue-name helix-media-log.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false
```

**Step 5: Configure SQS Trigger**
```bash
# Add Lambda as SQS trigger for FIFO queue
aws lambda create-event-source-mapping \
  --function-name helix3--media-log:v1 \
  --batch-size 1 \
  --event-source-arn arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:helix-media-log.fifo
```

## 7. Environment Variables

- **`HLX_MEDIA_LOGGING_ORGS`**: JSON array of organizations to enable org-level logging
  - Example: `["adobe", "microsoft"]`
- **`HLX_DEV_SERVER_HOST`**: Set when running locally (enables test mode)

## 8. Message Flow Examples

### Example 1: Media Added Event

```
1. MediaBus publishes to SQS:
   {
     "org": "adobe",
     "site": "blog",
     "ref": "main",
     "result": {
       "timestamp": 1705320000000,
       "mediaId": "img-12345",
       "action": "add",
       "path": "/media/hero-image.jpg",
       "mimeType": "image/jpeg",
       "size": 245760,
       "user": "editor@adobe.com"
     }
   }

2. EventBridge triggers Lambda every minute

3. events.js polls and groups:
   {
     "key": "adobe/blog",
     "updates": [{...media event...}]
   }

4. Sends to FIFO queue with MessageGroupId="adobe/blog"

5. trigger.js receives and writes to S3:
   helix-media-logs/adobe/blog/2024-01-15-10-30-45-ABC123.gz
```

### Example 2: Organization Logging

```
1. Event for org in HLX_MEDIA_LOGGING_ORGS:
   { "org": "adobe", "site": "blog", "result": {...} }

2. Creates TWO grouped messages:
   - key="adobe/blog"
   - key="adobe/*"

3. Writes to TWO locations:
   - helix-media-logs/adobe/blog/*.gz
   - helix-media-logs/adobe/*/*.gz
```

### Example 3: Media Update Event

```
{
  "org": "adobe",
  "site": "docs",
  "result": {
    "timestamp": 1705320000000,
    "mediaId": "doc-98765",
    "action": "update",
    "path": "/media/whitepaper.pdf",
    "mimeType": "application/pdf",
    "size": 1048576,
    "user": "content@adobe.com",
    "previousVersion": "v1"
  }
}
```

### Example 4: Media Delete Event

```
{
  "org": "adobe",
  "site": "marketing",
  "result": {
    "timestamp": 1705320000000,
    "mediaId": "vid-54321",
    "action": "delete",
    "path": "/media/old-video.mp4",
    "user": "admin@adobe.com",
    "reason": "outdated"
  }
}
```

## 9. Media Event Properties

### Standard Properties
- `timestamp`: Unix timestamp (milliseconds) when event occurred
- `mediaId`: Unique identifier for the media item
- `action`: One of `add`, `update`, `delete`
- `path`: Path to the media item in the repository
- `user`: User who performed the action
- `org`: Organization name
- `site`: Site name
- `ref`: Branch/reference name

### Optional Properties (action-dependent)
- `mimeType`: MIME type of the media file
- `size`: File size in bytes
- `width`: Image/video width in pixels
- `height`: Image/video height in pixels
- `duration`: Video/audio duration in seconds
- `previousVersion`: Previous version identifier (for updates)
- `reason`: Reason for deletion (for delete actions)
- `metadata`: Additional custom metadata

## 10. Error Handling

### Retry Mechanism
- Failed messages returned in `batchItemFailures`
- SQS automatically retries failed messages
- After max retries, messages move to dead-letter queue (if configured)

### Logging
- Structured logging using context.log
- Message IDs tracked throughout processing
- Error details logged with stack traces

## 11. Testing

### Unit Tests
```bash
npm test                    # Run all tests except post-deploy
npm run test-postdeploy     # Run post-deployment tests
```

### Local Development
```bash
npm run start               # Starts local dev server with nodemon
```

### Manual Testing
```bash
curl -X POST localhost:3000 \
  -H 'Content-Type: application/json' \
  -d '[{
    "messageId": "msg-0",
    "body": "{\"org\":\"test\",\"site\":\"site\",\"updates\":[{\"timestamp\":1705320000000,\"mediaId\":\"test-123\",\"action\":\"add\",\"path\":\"/test.jpg\"}]}"
  }]'
```

## 12. Key Dependencies

- **`@adobe/helix-admin-support`**: Provides `BatchedQueueClient`
- **`@adobe/helix-shared-wrap`**: Middleware composition
- **`@adobe/helix-shared-secrets`**: Secrets management
- **`@adobe/helix-status`**: Health check endpoints
- **`@aws-sdk/client-s3`**: S3 operations
- **`@aws-sdk/client-sqs`**: SQS operations

## 13. Monitoring & Health Checks

- **Health Check Endpoint**: `/_status_check/healthcheck.json`
- **Metrics**: Available through AWS CloudWatch
  - Lambda invocations
  - SQS queue metrics (messages sent, received, deleted)
  - S3 storage metrics (object count, size)
  - Error rates and durations

## 14. Security

- **IAM Role**: Limited to S3 read/write and SQS access
- **Authorizer**: Protected by `helix-token-authorizer_v2`
- **Secrets**: Managed via AWS Secrets Manager
- **Network**: Lambda runs in AWS VPC
- **Data**: All logs encrypted at rest in S3

## 15. Performance Characteristics

- **Processing Rate**: ~50 messages per minute (per invocation)
- **Latency**: Sub-second for small batches
- **Throughput**: Scales with SQS queue depth
- **Storage**: Efficient compression with gzip (typical 80-90% reduction)
- **Cost**: Pay-per-invocation Lambda model

## 16. Limitations & Considerations

- **SQS Batch Size**: Set to 1 to avoid timeout issues
- **Visibility Timeout**: Processing must complete within 30 seconds
- **File Size**: Max 512KB per log file (compressed)
- **FIFO Queue**: Limited to 300 TPS per MessageGroupId
- **Message Ordering**: Guaranteed per org/site within FIFO queue

## 17. Use Cases

### Analytics & Reporting
- Track media usage patterns across sites
- Identify most frequently added/updated media types
- Monitor storage growth trends
- User activity analysis

### Compliance & Auditing
- Complete audit trail of all media changes
- Track who added/deleted specific media items
- Retention policy compliance
- Data governance requirements

### Troubleshooting
- Debug media-related issues
- Track when specific media was added/removed
- Identify patterns in media failures
- Performance optimization

### Business Intelligence
- Measure content velocity
- Track content lifecycle
- Identify popular media types
- Site-level and org-level reporting

## 18. Integration Points

### MediaBus Integration
Services publish media events to the input SQS queue whenever:
- Media is uploaded
- Media metadata is updated
- Media is deleted or archived
- Media is moved or renamed

### Downstream Consumers
The S3 logs can be consumed by:
- Analytics pipelines (AWS Athena, Glue)
- Business intelligence tools
- Custom reporting applications
- Archive/compliance systems

---

**Version**: 1.0.0  
**Last Updated**: October 2025  
**Maintained By**: Adobe Helix Team

