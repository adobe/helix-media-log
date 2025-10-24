# Helix Media Log

> Receives media notifications from Helix MediaBus and logs them to S3

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-media-log.svg)](https://codecov.io/gh/adobe/helix-media-log)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/adobe/helix-media-log/main.yaml)](https://github.com/adobe/helix-media-log/actions/workflows/main.yaml)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-media-log.svg)](https://github.com/adobe/helix-media-log/blob/main/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-media-log.svg)](https://github.com/adobe/helix-media-log/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-media-log.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-media-log)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Overview

The Helix Media Log service collects, processes, and stores media activity notifications for Adobe Helix projects. It tracks whenever media items (images, videos, documents, etc.) are added, updated, or deleted in the MediaBus system.

**Key Features:**
- **Automatic Batching**: Groups media events by organization/site for efficient processing
- **Scalable Architecture**: Uses AWS Lambda, SQS, and S3 for automatic scaling
- **Compressed Storage**: Stores logs as gzipped JSON files in S3
- **Organization-Level Logging**: Optional aggregated logs for entire organizations
- **Large Message Support**: Automatically handles messages exceeding SQS limits

For detailed architecture and implementation details, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## Architecture

```
MediaBus → SQS Input Queue → Lambda (Batch) → SQS FIFO Queue → Lambda (Write) → S3
                    ↑                                                            ↓
              EventBridge (1min)                                    helix-media-logs/
```

## Installation

After deploying the service, you need to set up the infrastructure:

### 1. Create EventBridge Rule

```bash
aws events put-rule \
  --name media-log-every-minute \
  --schedule-expression "rate(1 minute)"
```

### 2. Grant Lambda Permissions

```bash
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=118435662149

aws lambda add-permission \
  --statement-id "rule-media-log-every-minute" \
  --function-name "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1" \
  --action 'lambda:InvokeFunction' \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/media-log-every-minute"
```

### 3. Add Lambda as EventBridge Target

```bash
aws events put-targets \
  --rule media-log-every-minute \
  --targets "Id"="1","Arn"="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--media-log:v1"
```

### 4. Create SQS Queues

```bash
# Input queue (standard)
aws sqs create-queue --queue-name helix-media-log

# Output queue (FIFO)
aws sqs create-queue \
  --queue-name helix-media-log.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false
```

### 5. Configure SQS Trigger

```bash
aws lambda create-event-source-mapping \
  --function-name helix3--media-log:v1 \
  --batch-size 1 \
  --event-source-arn arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:helix-media-log.fifo
```

## Usage

### Publishing Media Events

Services should publish media events to the `helix-media-log` SQS queue:

```json
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
```

### Media Event Types

**Add Media**:
```json
{
  "action": "add",
  "mediaId": "img-12345",
  "path": "/media/image.jpg",
  "mimeType": "image/jpeg",
  "size": 245760,
  "timestamp": 1705320000000,
  "user": "user@example.com"
}
```

**Update Media**:
```json
{
  "action": "update",
  "mediaId": "img-12345",
  "path": "/media/image.jpg",
  "previousVersion": "v1",
  "timestamp": 1705320000000,
  "user": "user@example.com"
}
```

**Delete Media**:
```json
{
  "action": "delete",
  "mediaId": "img-12345",
  "path": "/media/image.jpg",
  "reason": "outdated",
  "timestamp": 1705320000000,
  "user": "user@example.com"
}
```

### Organization-Level Logging

To enable organization-wide aggregate logs, set the `HLX_MEDIA_LOGGING_ORGS` environment variable:

```bash
aws lambda update-function-configuration \
  --function-name helix3--media-log:v1 \
  --environment "Variables={HLX_MEDIA_LOGGING_ORGS='[\"adobe\",\"microsoft\"]'}"
```

This will create logs in both:
- `s3://helix-media-logs/org/site/` (site-specific)
- `s3://helix-media-logs/org/*/` (organization-wide)

### Accessing Logs

Logs are stored in S3 at `s3://helix-media-logs/`:

```
helix-media-logs/
├── adobe/
│   ├── blog/
│   │   ├── .index
│   │   ├── 2024-01-15-10-30-45-ABC123.gz
│   │   └── 2024-01-15-12-00-00-DEF456.gz
│   └── docs/
│       └── ...
└── microsoft/
    └── ...
```

**Reading Logs**:
```bash
# Download and decompress
aws s3 cp s3://helix-media-logs/adobe/blog/2024-01-15-10-30-45-ABC123.gz - | gunzip | jq .

# List all logs for a site
aws s3 ls s3://helix-media-logs/adobe/blog/
```

## Development

### Local Development

Start the development server:

```bash
npm install
npm run start
```

The server will be available at `http://localhost:3000`.

### Testing Locally

```bash
curl -X POST localhost:3000 \
  -H 'Content-Type: application/json' \
  -d '[{
    "messageId": "msg-0",
    "body": "{\"org\":\"test\",\"site\":\"site\",\"updates\":[{\"timestamp\":1705320000000,\"mediaId\":\"test-123\",\"action\":\"add\",\"path\":\"/test.jpg\"}]}"
  }]'
```

### Running Tests

```bash
npm test                    # Run unit tests
npm run test-postdeploy     # Run post-deployment tests
npm run lint                # Run linter
```

### Deploying

```bash
npm run build               # Build and validate
npm run deploy              # Deploy to AWS
```

## Configuration

### Environment Variables

- **`HLX_MEDIA_LOGGING_ORGS`**: JSON array of organizations for org-level logging
- **`HLX_DEV_SERVER_HOST`**: Set when running locally

### Lambda Configuration

- **Runtime**: Node.js 22
- **Memory**: 1024 MB
- **Timeout**: 5 minutes
- **IAM Role**: `helix-service-role-s3-rw`

## Monitoring

### Health Check

```bash
curl https://helix-pages.anywhere.run/helix3/media-log@v1/_status_check/healthcheck.json
```

### CloudWatch Metrics

Monitor these metrics in AWS CloudWatch:
- Lambda invocations and errors
- SQS message counts (sent, received, deleted)
- SQS age of oldest message
- S3 bucket size and object count

### Logging

All logs are available in CloudWatch Logs under the Lambda function log groups.

## Troubleshooting

### Messages Not Being Processed

1. Check SQS queue depth: `aws sqs get-queue-attributes --queue-url <url>`
2. Verify EventBridge rule is enabled: `aws events describe-rule --name media-log-every-minute`
3. Check Lambda errors in CloudWatch Logs

### S3 Writes Failing

1. Verify IAM role has S3 write permissions
2. Check S3 bucket exists: `aws s3 ls s3://helix-media-logs/`
3. Review Lambda logs for error details

### Performance Issues

1. Ensure SQS trigger batch size is set to 1
2. Monitor Lambda duration and memory usage
3. Check for visibility timeout issues in SQS

## Documentation

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - Complete technical documentation
- [API.md](docs/API.md) - API documentation

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

Apache-2.0. See [LICENSE.txt](LICENSE.txt) for details.

---

**Maintained by**: Adobe Helix Team  
**Repository**: https://github.com/adobe/helix-media-log
