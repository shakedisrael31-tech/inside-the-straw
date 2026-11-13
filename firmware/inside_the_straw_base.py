# Inside the Straw - WIRELESS BASE half (MicroPython)
#
# Flash this onto the micro:bit that stays plugged into the computer with a
# USB cable. It does not read its own accelerometer or buttons at all - it
# just listens for messages on the radio from inside_the_straw_remote.py
# (the micro:bit the player holds) and repeats each one straight over USB
# serial, unchanged. The game reads that serial line exactly as it always
# has, so nothing on the game side needs to change.
#
# Flash with the official editor at https://python.microbit.org
# (Create new project, paste this file, Send to micro:bit). See README.md.
#
# IMPORTANT: CHANNEL must be the same number as in inside_the_straw_remote.py,
# or this micro:bit will never hear the other one.

from microbit import display, Image
import radio

CHANNEL = 42

radio.config(channel=CHANNEL, length=64, power=7)
radio.on()

display.show(Image.ARROW_N)   # same "ready" arrow as the wired firmware

while True:
    msg = radio.receive()
    if msg:
        print(msg)
