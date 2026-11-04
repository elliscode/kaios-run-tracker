TIMESTAMP=$(date +%s)
zip -r runtracker-${TIMESTAMP}.zip . -x "*.zip" -x "*.DS_Store" -x release.sh
