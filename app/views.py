import mysql.connector
import json
import os

from app import app
from datetime import datetime
from flask import request

try:
    dbpass = os.environ['MOVIETHING_SQL_PASS']
except KeyError:
    print("Environment variable MOVIETHING_SQL_PASS must contain MySQL Password")
    exit(-1)

conn = mysql.connector.connect(host="donkey.grahams.wtf", 
                       user="movies", 
                       passwd=dbpass,
                       db="movies")

@app.route('/')
def home():
    year = request.args.get('year')

    if(year == None):
        year = str(datetime.now().year)

    startDate = year + "0101"
    endDate = year + "1231"

    return getJSONBetweenDates(startDate, endDate)

def getJSONBetweenDates(startDate, endDate):
    results = []
    global conn
    conn.reconnect()
    c = conn.cursor()

    try:
        c.execute("SELECT movieTitle,viewingDate,movieURL,viewFormat,viewLocation,firstViewing,movieGenre,movieReview FROM movies WHERE viewingDate BETWEEN date('%s') AND date('%s')" % (startDate, endDate))
    except MySQLdb.OperationalError:
        conn = MySQLdb.connect(host="slice.dosburros.com", 
                               user="movies", 
                               passwd="ENsYfPsxfFTJbSQy", 
                               db="movies")
        c.execute("SELECT movieTitle,viewingDate,movieURL,viewFormat,viewLocation,firstViewing,movieGenre,movieReview FROM movies WHERE viewingDate BETWEEN date('%s') AND date('%s')" % (startDate, endDate))
        
    for row in c:
        result = {}

        dt = row[1]

        if(dt):
            dt = dt.strftime("%Y-%m-%d")

        result["movieTitle"] = row[0]
        result["viewingDate"] = dt
        result["movieURL"] = row[2]
        result["viewFormat"] = row[3]
        result["viewLocation"] = row[4]
        result["firstViewing"] = row[5]
        result["movieGenre"] = row[6]
        result["movieReview"] = row[7]

        results.append(result)

    return json.dumps(results, ensure_ascii=False)
