FROM postgres:18-alpine
RUN apk add --no-cache age rclone
COPY backup.sh restore.sh nightly.sh /usr/local/bin/
USER postgres
ENTRYPOINT []
CMD ["nightly.sh"]
