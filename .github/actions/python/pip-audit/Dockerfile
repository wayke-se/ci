FROM python:3.13-slim

RUN pip3 install pip-audit

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]