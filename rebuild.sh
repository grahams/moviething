#!/bin/bash
app="grahams/moviething:latest"
docker rmi ${app}
docker build -t ${app} .
