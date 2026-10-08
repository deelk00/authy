FROM kai-codex-runner@sha256:27edcc606ebadb4a41854413aa6dde529ed072b48f7a82b402cc6031b72ec4b6

RUN groupadd --gid 10002 authy \
    && useradd --uid 10002 --gid authy --create-home --shell /usr/sbin/nologin authy

COPY docker/authy-entrypoint.sh /usr/local/bin/authy-entrypoint
RUN chmod 0555 /usr/local/bin/authy-entrypoint

ENV HOME=/home/authy \
    CODEX_HOME=/home/authy/.codex

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/authy-entrypoint"]
CMD ["sleep", "infinity"]
