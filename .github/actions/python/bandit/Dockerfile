FROM python:3.11-slim
WORKDIR /github/workspace

RUN pip3 install bandit

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]