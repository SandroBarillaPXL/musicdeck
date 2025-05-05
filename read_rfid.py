import MFRC522
import signal
import sys

reader = MFRC522.MFRC522()

try:
    (status, TagType) = reader.MFRC522_Request(reader.PICC_REQIDL)
    if status != reader.MI_OK:
        sys.exit(1)

    (status, uid) = reader.MFRC522_Anticoll()
    if status != reader.MI_OK:
        sys.exit(1)

    uid_str = " ".join(str(x) for x in uid)

    key = [0xFF] * 6  # Default key

    block = 8  # Chosen memory block
    if reader.MFRC522_Auth(reader.PICC_AUTHENT1A, block, key, uid) != reader.MI_OK:
        sys.exit(1)

    data = reader.MFRC522_Read(block)
    reader.MFRC522_StopCrypto1()

    # Clean up and convert byte array to string
    text = ''.join([chr(x) for x in data if x != 0])

    print(f"{uid_str}|{text}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
