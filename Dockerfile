FROM tiangolo/uwsgi-nginx-flask:latest
LABEL org.opencontainers.image.source="https://github.com/grahams/moviething"

ENV STATIC_URL=/static
ENV STATIC_PATH=/var/www/app/static

RUN apt-get install wget
RUN wget https://r.mariadb.com/downloads/mariadb_repo_setup
RUN echo "6083ef1974d11f49d42ae668fb9d513f7dc2c6276ffa47caed488c4b47268593 mariadb_repo_setup" | sha256sum -c -
RUN chmod +x mariadb_repo_setup
RUN ./mariadb_repo_setup --mariadb-server-version="mariadb-11.4"

RUN apt install -y libmariadb-dev
RUN apt install -y libmariadb3 

COPY ./requirements.txt /var/www/requirements.txt
RUN pip install -r /var/www/requirements.txt
