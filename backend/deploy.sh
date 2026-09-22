#!/bin/bash
set -e

rm -rf package deployment.zip

pip install \
  --target ./package \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  --no-cache-dir \
  google-genai python-dotenv

cp src/rewrite.py package/
cp src/handler.py package/
sed -i '' 's/from src.rewrite import rewrite/from rewrite import rewrite/' package/handler.py

cd package
zip -r ../deployment.zip . > /dev/null
cd ..

aws lambda update-function-code --function-name polishai-rewrite --zip-file fileb://deployment.zip