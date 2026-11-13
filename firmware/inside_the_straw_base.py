# Inside the Straw - WIRELESS BASE half (MicroPython)
#
# Flash this onto the micro:bit that stays plugged into the computer with a
# USB cable. It does not read its own accelerometer or buttons at all - it
# listens for messages on the radio from inside_the_straw_remote.py (the
# micro:bit the player holds) and repeats them over USB serial in the same
# line format the game already expects, so nothing on the game side needs
# to change.
#
# Flash with the official editor at https://python.microbit.org
# (Create new project, paste this file, Send to micro:bit). See README.md.
#
# IMPORTANT: CHANNEL must be the same number as in inside_the_straw_remote.py,
# or this micro:bit will never hear the other one.
#
# Why this isn't just "print whatever the radio hands us": radio packets
# occasionally go missing over the air, even a few centimetres away - that's
# normal and expected, not a fault. If this micro:bit only printed when a
# packet actually arrived, a single dropped packet would leave a real gap in
# the serial stream, and the game treats too long a gap as "the controller
# went stale" and snaps the controls to zero until fresh data shows up again
# - which is exactly the "stops and goes" stutter a steady tilt should never
# cause. So instead this micro:bit keeps its own steady 50 Hz clock and always
# sends the latest tilt/buttons it knows about, with its own sequence number.
# A dropped radio packet then just repeats the last known reading for one
# tick, instead of creating a gap.

from microbit import display, Image, sleep, running_time
import radio

CHANNEL = 42

radio.config(channel=CHANNEL, length=64, power=7)
radio.on()

display.show(Image.ARROW_N)   # same "ready" arrow as the wired firmware

# Latest tilt/buttons heard from the remote. Starts flat and at rest so the
# game sees sane numbers even before the first radio packet arrives.
last_x, last_y, last_z, last_a, last_b = 0, 0, -1000, 0, 0


def parse(msg):
    # Pulls x, y, z, a, b out of a line like:
    #   {"s":1042,"x":-48,"y":112,"z":-1008,"a":0,"b":0}
    # Written by hand (no json module) to keep this firmware tiny.
    try:
        x = y = z = a = b = None
        for part in msg[1:-1].split(','):
            k, v = part.split(':')
            k = k.strip().strip('"')
            v = int(v.strip())
            if k == 'x': x = v
            elif k == 'y': y = v
            elif k == 'z': z = v
            elif k == 'a': a = v
            elif k == 'b': b = v
        if None in (x, y, z, a, b):
            return None
        return x, y, z, a, b
    except Exception:
        return None


seq = 0
PERIOD = 20                   # milliseconds between messages (50 Hz), same
                               # rate the game expects - with or without a
                               # fresh radio packet this tick
next_t = running_time()

while True:
    msg = radio.receive()
    if msg:
        parsed = parse(msg)
        if parsed:
            last_x, last_y, last_z, last_a, last_b = parsed
    print('{"s":%d,"x":%d,"y":%d,"z":%d,"a":%d,"b":%d}' % (
        seq, last_x, last_y, last_z, last_a, last_b))
    seq = (seq + 1) & 0xFFFF
    next_t += PERIOD
    wait = next_t - running_time()
    if wait > 0:
        sleep(wait)
    else:
        next_t = running_time()   # fell behind: do not try to catch up
