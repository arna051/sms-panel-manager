# Security policy

Do not report provider credentials, customer phone numbers, message parameters, or private provider responses in a public issue. Rotate exposed credentials before using the repository owner's private security channel.

The package treats provider credentials as write-only and does not retain message bodies or semantic values by default. Applications remain responsible for authentication, authorization, rate limiting, key storage, MongoDB security, and lawful recipient consent.

Live provider tests and real SMS sends are outside the normal suite and require explicit operator authorization.
