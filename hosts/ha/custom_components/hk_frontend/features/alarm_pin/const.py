"""Alarm PIN's constants."""

# entry.data -- what the entry IS: the alarm it protects (changed in Configure)
CONF_ALARM = "alarm"

# entry.options -- the arm rule, and the PIN as pin.hash_pin keeps it (salt,
# hash, iterations, numeric: never the PIN itself)
CONF_ARM_REQUIRED = "arm_required"

# the Add flow's abort for an alarm that has a PIN already ("already_configured"
# is the house entry's)
ALREADY = "alarm_pin_already_configured"
