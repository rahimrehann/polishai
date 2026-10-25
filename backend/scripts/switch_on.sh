#!/bin/sh
# Switches PolishAI back on after the kill switch (or switch_off.sh) stopped it.
aws lambda delete-function-concurrency --function-name polishai-rewrite --region us-east-1
echo "PolishAI is ON again."
