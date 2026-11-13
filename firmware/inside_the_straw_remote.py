# Inside the Straw - WIRELESS CONTROLLER half (MicroPython)
#
# Flash this onto the micro:bit the player actually holds - the one that is
# battery-powered only, with no USB cable to the computer. It reads the
# tilt and buttons and broadcasts them over the micro:bit's built-in radio.
# It does not talk to the computer at all.
#
# The other half, inside_the_straw_base.py, goes on the micro:bit that stays
# plugged into the computer: it listens on the radio and repeats everything
# straight over USB serial, in exactly the same line format the game already
# expects. So the game itself needs no changes for this to work.
#
# Flash with the official editor at https://python.microbit.org
# (Create new project, paste this file, Send to micro:bit). See README.md.
#
# IMPORTANT: the CHANNEL number below must be identical on both micro:bits,
# or they will not hear each other. If you have other micro:bit radio
# projects nearby, pick a different channel (0-83) on both halves so they
# do not collide.

from microbit import accelerometer, button_a, button_b, display, Image, sleep, running_time
import radio

CHANNEL = 42

radio.config(channel=CHANNEL, length=64, power=7)
radio.on()

display.show(Image.ARROW_N)   # the arrow points away from you: that way is "forward"

seq = 0
PERIOD = 20                   # milliseconds between messages (50 Hz)
next_t = running_time()

while True:
    x, y, z = accelerometer.get_values()
    radio.send('{"s":%d,"x":%d,"y":%d,"z":%d,"a":%d,"b":%d}' % (
        seq, x, y, z, 1 if button_a.is_pressed() else 0, 1 if button_b.is_pressed() else 0))
    seq = (seq + 1) & 0xFFFF
    next_t += PERIOD
    wait = next_t - running_time()
    if wait > 0:
        sleep(wait)
    else:
        next_t = running_time()   # fell behind: do not try to catch up
