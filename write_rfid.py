import MFRC522
import signal
import sys

reader = MFRC522.MFRC522()
uri = "spotify:album:3DQueEd1Ft9PHWgovDzPKh" # Fred again.. - ten days

data = [ord(c) for c in uri.ljust(16, '\x00')]  # Block is 16 bytes
block = 8
key = [0xFF] * 6

(status, TagType) = reader.MFRC522_Request(reader.PICC_REQIDL)
(status, uid) = reader.MFRC522_Anticoll()

if reader.MFRC522_Auth(reader.PICC_AUTHENT1A, block, key, uid) == reader.MI_OK:
    reader.MFRC522_Write(block, data)
    reader.MFRC522_StopCrypto1()
    print("URI written to card.")
else:
    print("Authentication failed.")