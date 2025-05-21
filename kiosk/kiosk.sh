#!/bin/bash
KIOSK_URL="http://localhost:5500"
# Wait for services to come online.
sleep 10
echo 'Starting Chromium...'
/usr/bin/chromium-browser --noerrdialogs --disable-infobars --incognito --enable-virtual-keyboard --kiosk $KIOSK_URL