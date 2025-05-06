import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

reader = SimpleMFRC522()

try:
        uri = "spotify:album:3DQueEd1Ft9PHWgovDzPKh" # Fred again.. - ten days
        print("Now place your tag to write")
        reader.write(uri)
        print("Written")
finally:
        GPIO.cleanup()