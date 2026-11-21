# Pinned by digest, and age and rclone by version (pen test I4, #183): they encrypt and ship every backup, so what they
# are is fixed by this checkout. Alpine keeps only the current build of a package, so when one goes the build stops
# here; bump the digest and versions together, as docs/operations/deploying.md, "Updating an image", describes.
FROM postgres:18-alpine@sha256:ff64c9e3bdf8e2120107d3559de8db314e8305f7e38c5105903c6295876738ff
RUN apk add --no-cache age=1.3.2-r1 rclone=1.75.2-r0
COPY backup.sh restore.sh nightly.sh backup-health.sh /usr/local/bin/
USER postgres
ENTRYPOINT []
CMD ["nightly.sh"]
