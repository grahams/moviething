FROM tiangolo/uwsgi-nginx-flask:latest
ENV STATIC_URL=/static
ENV STATIC_PATH=/var/www/app/static

RUN apt-get install wget
RUN wget https://r.mariadb.com/downloads/mariadb_repo_setup
RUN echo "26e5bf36846003c4fe455713777a4e4a613da0df3b7f74b6dad1cb901f324a84  mariadb_repo_setup" | sha256sum -c -
RUN chmod +x mariadb_repo_setup
RUN ./mariadb_repo_setup --mariadb-server-version="mariadb-11.4"

RUN apt install -y libmariadb-dev
RUN apt install -y libmariadb3 

COPY ./requirements.txt /var/www/requirements.txt
RUN pip install -r /var/www/requirements.txt
