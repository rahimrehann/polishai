#!/bin/sh
# EMERGENCY STOP: PolishAI refuses every request right now, so nothing more can be billed.
# (The automatic kill switch does the same thing when it spots a flood or a big bill.)
aws lambda put-function-concurrency --function-name polishai-rewrite --reserved-concurrent-executions 0 --region us-east-1
echo "PolishAI is OFF. To switch it back on: sh backend/scripts/switch_on.sh"
