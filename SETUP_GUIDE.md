# Helix Media Log - Setup Guide

This guide will help you get the Helix Media Log service up and running.

## What Was Created

I've created a complete media logging service based on the helix-audit-logger architecture. Here's what's included:

### Source Files
```
src/
├── index.js              # Main entry point with request routing
├── events.js             # Scheduled event poller (batches messages)
├── trigger.js            # SQS trigger handler (writes to S3)
└── s3/
    ├── MediaLog.js       # S3 storage management
    └── DateFormat.js     # Date formatting utility
```

### Test Files
```
test/
├── dev/
│   └── server.mjs        # Local development server
├── events.test.js        # Unit tests for events
├── trigger.test.js       # Unit tests for trigger
└── s3/
    ├── MediaLog.test.js  # Unit tests for MediaLog
    └── DateFormat.test.js # Unit tests for DateFormat
```

### Documentation
- **PROJECT_OVERVIEW.md** - Complete technical documentation
- **README.md** - User guide with setup instructions
- **SETUP_GUIDE.md** - This file

### Configuration Files
- **package.json** - Updated with all dependencies and AWS configuration
- **.mocha-multi.json** - Test reporter configuration
- **.gitignore** - Git ignore rules
- **secrets/fetch-dev-secrets.sh** - Script to fetch dev secrets from AWS

## Quick Start

### 1. Install Dependencies

```bash
cd /Users/amol/Documents/git-repos/adobe/helix-media-log
npm install
```

### 2. Local Development

Start the development server:
```bash
npm run start
```

Test locally:
```bash
curl -X POST localhost:3000 \
  -H 'Content-Type: application/json' \
  -d '[{
    "messageId": "msg-0",
    "body": "{\"org\":\"test\",\"site\":\"site\",\"updates\":[{\"timestamp\":1705320000000,\"mediaId\":\"test-123\",\"action\":\"add\",\"path\":\"/test.jpg\"}]}"
  }]'
```

### 3. Run Tests

```bash
npm test
```

### 4. Deploy to AWS

```bash
npm run build    # Build and validate
npm run deploy   # Deploy to AWS
```

## AWS Infrastructure Setup

After deploying the Lambda function, you need to set up the supporting AWS infrastructure:

### Prerequisites

Set your AWS region and account ID:
```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=118435662149
```

### Step 1: Create SQS Queues

```bash
# Input queue (standard)
aws sqs create-queue --queue-name helix-media-log

# Output queue (FIFO)
aws sqs create-queue \
  --queue-name helix-media-log.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false
```

### Step 2: Create S3 Bucket

```bash
aws s3 mb s3://helix-media-logs --region $AWS_REGION
```

### Step 3: Set Up EventBridge (CloudWatch Events)

Create a rule that triggers every minute:
```bash
aws events put-rule \
  --name media-log-every-minute \
  --schedule-expression "rate(1 minute)"
```

Grant permission for the rule to invoke your Lambda:
```bash
aws lambda add-permission \
  --statement-id "rule-media-log-every-minute" \
  --function-name "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1" \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/media-log-every-minute"
```

Add the Lambda as a target:
```bash
aws events put-targets \
  --rule media-log-every-minute \
  --targets "Id"="1","Arn"="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1"
```

### Step 4: Configure SQS Trigger

Set up the Lambda to be triggered by the FIFO queue:
```bash
aws lambda create-event-source-mapping \
  --function-name helix3--media-log:v1 \
  --batch-size 1 \
  --event-source-arn arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:helix-media-log.fifo
```

### Step 5: (Optional) Enable Organization-Level Logging

To enable aggregate logging for entire organizations:
```bash
aws lambda update-function-configuration \
  --function-name helix3--media-log:v1 \
  --environment "Variables={HLX_MEDIA_LOGGING_ORGS='[\"adobe\"]'}"
```

## Verification

### 1. Check Lambda Function

```bash
aws lambda get-function --function-name helix3--media-log:v1
```

### 2. Check EventBridge Rule

```bash
aws events describe-rule --name media-log-every-minute
```

### 3. Check SQS Queues

```bash
# Input queue
aws sqs get-queue-url --queue-name helix-media-log

# FIFO queue
aws sqs get-queue-url --queue-name helix-media-log.fifo
```

### 4. Check S3 Bucket

```bash
aws s3 ls s3://helix-media-logs/
```

### 5. Test Health Check

```bash
curl https://helix-pages.anywhere.run/helix3/media-log@v1/_status_check/healthcheck.json
```

## Publishing Media Events

Services should publish media events to the `helix-media-log` SQS queue. Here's an example using AWS CLI:

```bash
aws sqs send-message \
  --queue-url https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/helix-media-log \
  --message-body '{
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
  }'
```

## Monitoring

### CloudWatch Logs

View Lambda logs:
```bash
aws logs tail /aws/lambda/helix3--media-log:v1 --follow
```

### CloudWatch Metrics

Key metrics to monitor:
- Lambda invocations
- Lambda errors
- Lambda duration
- SQS ApproximateNumberOfMessagesVisible
- SQS ApproximateAgeOfOldestMessage
- S3 NumberOfObjects
- S3 BucketSizeBytes

### Reading Logs from S3

List logs for a site:
```bash
aws s3 ls s3://helix-media-logs/adobe/blog/
```

Download and view a log file:
```bash
aws s3 cp s3://helix-media-logs/adobe/blog/2024-01-15-10-30-45-ABC123.gz - | gunzip | jq .
```

## Troubleshooting

### Lambda Not Being Triggered

1. Verify EventBridge rule is enabled:
   ```bash
   aws events describe-rule --name media-log-every-minute
   ```

2. Check rule targets:
   ```bash
   aws events list-targets-by-rule --rule media-log-every-minute
   ```

3. Check Lambda permissions:
   ```bash
   aws lambda get-policy --function-name helix3--media-log:v1
   ```

### Messages Stuck in Queue

1. Check queue depth:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url https://sqs.${AWS_REGION}.amazonaws.com/${AWS_ACCOUNT_ID}/helix-media-log \
     --attribute-names All
   ```

2. Check visibility timeout and dead-letter queue settings

3. Review Lambda error logs in CloudWatch

### S3 Write Failures

1. Verify IAM role has S3 permissions:
   ```bash
   aws iam get-role --role-name helix-service-role-s3-rw
   ```

2. Check bucket policy and permissions

3. Review Lambda logs for specific error messages

## Key Differences from Audit Logger

While based on the audit-logger architecture, the media log has some key differences:

1. **Bucket Name**: Uses `helix-media-logs` instead of `helix-adobe-logs`
2. **Queue Names**: Uses `helix-media-log` and `helix-media-log.fifo`
3. **Environment Variable**: Uses `HLX_MEDIA_LOGGING_ORGS` instead of `HLX_LOGGING_ORGS`
4. **Purpose**: Tracks media events instead of general audit events
5. **Event Structure**: Optimized for media metadata (paths, MIME types, sizes, etc.)

## Next Steps

1. **Set up monitoring alerts** in CloudWatch for:
   - Lambda errors
   - High SQS queue depth
   - S3 storage growth

2. **Configure dead-letter queues** for failed messages

3. **Set up S3 lifecycle policies** for log archival/deletion

4. **Create IAM policies** for services that need to publish events

5. **Document your media event schema** for consuming services

6. **Set up log analysis** using AWS Athena or similar tools

## Resources

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - Complete technical documentation
- [README.md](README.md) - User guide
- [Helix Audit Logger](../helix-audit-logger/) - Reference implementation

## Support

For issues or questions:
- Open an issue on GitHub: https://github.com/adobe/helix-media-log/issues
- Contact the Adobe Helix Team

---

**Setup Complete!** Your Helix Media Log service is ready to track media events across your Helix projects.

