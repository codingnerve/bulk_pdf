#!/bin/sh
# One-shot job: wait for the S3 gateway, then make sure the bucket exists.
set -eu

echo "waiting for object storage at ${S3_ENDPOINT} ..."
i=0
until aws --endpoint-url "${S3_ENDPOINT}" s3api list-buckets >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "object storage did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done

if aws --endpoint-url "${S3_ENDPOINT}" s3api head-bucket --bucket "${S3_BUCKET}" >/dev/null 2>&1; then
  echo "bucket ${S3_BUCKET} already exists"
else
  aws --endpoint-url "${S3_ENDPOINT}" s3api create-bucket --bucket "${S3_BUCKET}"
  echo "created bucket ${S3_BUCKET}"
fi
