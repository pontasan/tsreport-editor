#!/bin/bash
set -eu
# cron jobs do not inherit the container environment, so materialize the crontab
# at startup: prepend the shell and the batch token, then append the schedule
# mounted from outside the image (server/crond/schedule.txt).
{
  echo "SHELL=/bin/bash"
  echo "REPORT_BATCH_TOKEN=${REPORT_BATCH_TOKEN}"
  cat /var/crond/schedule.txt
} | crontab -
exec "$@"
