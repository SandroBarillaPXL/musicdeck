import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

reader = SimpleMFRC522()

try:
        uri = input("Enter the URI to write to the tag: ")
        reader.write(uri)
        print("Written")
finally:
        GPIO.cleanup()