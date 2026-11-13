# Inside the Straw - micro:bit v2 controller firmware (MicroPython)
#
# Flash with the official editor at https://python.microbit.org
# (paste this file, press "Send to micro:bit"). See README.md.
#
# Protocol: one JSON object per line over USB serial at 115200 baud,
# about 50 times per second:
#
#   {"s":1042,"x":-48,"y":112,"z":-1008,"a":0,"b":0}
#
#   s      sequence number 0..65535 (wraps)
#   x,y,z  accelerometer, milli-g
#   a,b    buttons, 1 while held
#
# The game does all smoothing, calibration and jump edge detection,
# so this program stays as simple as possible.

from microbit import accelerometer, button_a, button_b, display, Image, sleep, running_time

display.show(Image.ARROW_N)   # the arrow points away from you: that way is "forward"

seq = 0
PERIOD = 20                   # milliseconds between messages (50 Hz)
next_t = running_time()

while True:
    x, y, z = accelerometer.get_values()
    print('{"s":%d,"x":%d,"y":%d,"z":%d,"a":%d,"b":%d}' % (
        seq, x, y, z, 1 if button_a.is_pressed() else 0, 1 if button_b.is_pressed() else 0))
    seq = (seq + 1) & 0xFFFF
    next_t += PERIOD
    wait = next_t - running_time()
    if wait > 0:
        sleep(wait)
    else:
        next_t = running_time()   # fell behind: do not try to catch up
