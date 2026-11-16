#!/bin/sh
# Writes the S3 identity file from environment variables, then starts a single-node SeaweedFS
# (master + volume + filer + S3 gateway). Credentials never live in the image or in git.
set -eu

: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

cat > /tmp/s3.json <<EOF
{
  "identities": [
    {
      "name": "pdflinker",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
EOF

exec weed server \
  -dir=/data \
  -ip=seaweed \
  -filer \
  -s3 -s3.port=8333 -s3.config=/tmp/s3.json \
  -master.volumeSizeLimitMB=1024 \
  -volume.max=0
