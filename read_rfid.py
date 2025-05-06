import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522

reader = SimpleMFRC522()

try:
    id = reader.read_id_no_block()
    if id is None:
        # No card detected
        print("")
        print("")
    else:
        _, text = reader.read()  # This still blocks, but only if a card is present
        print(id)
        print(text.strip())  # Strip newline or trailing spaces
finally:
    GPIO.cleanup()
