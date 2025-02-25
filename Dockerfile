FROM tiangolo/uwsgi-nginx-flask:latest
LABEL org.opencontainers.image.source="https://github.com/grahams/moviething"

ENV STATIC_URL=/static
ENV STATIC_PATH=/var/www/app/static

RUN apt-get install wget
RUN wget https://r.mariadb.com/downloads/mariadb_repo_setup
RUN echo "c4a0f3dade02c51a6a28ca3609a13d7a0f8910cccbb90935a2f218454d3a914a mariadb_repo_setup" | sha256sum -c -
RUN chmod +x mariadb_repo_setup
RUN ./mariadb_repo_setup --mariadb-server-version="mariadb-11.4"

RUN apt install -y libmariadb-dev
RUN apt install -y libmariadb3 

COPY ./requirements.txt /var/www/requirements.txt
RUN pip install -r /var/www/requirements.txt
