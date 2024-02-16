FROM python:3.13-slim

RUN pip3 install bandit

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]