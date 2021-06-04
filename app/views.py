import mysql.connector
import json
import os
import re
import urllib
import dateutil.parser 

from functools import wraps
from app import app
from datetime import datetime
from flask import Flask, request, abort

try:
    dbpass = os.environ['MOVIETHING_SQL_PASS']
    omdbApiKey = os.environ['MOVIETHING_OMDB_API_KEY']
    validApiKey = os.environ['MOVIETHING_VALID_API_KEY']

except KeyError as e:
    print(f"Missing environment variable: {e.args[0]} ")
    exit(-1)

conn = mysql.connector.connect(host="donkey.grahams.wtf", 
                       user="movies", 
                       passwd=dbpass,
                       db="movies")

def requireApiKey(view_function):
    @wraps(view_function)
    # the new, post-decoration function. Note *args and **kwargs here.
    def decorated_function(*args, **kwargs):
        if request.args.get('apiKey') and request.args.get('apiKey') == validApiKey:
            return view_function(*args, **kwargs)
        else:
            abort(401)
    return decorated_function

@app.route('/')
def home():
    year = request.args.get('year')

    if(year == None):
        year = str(datetime.now().year)

    startDate = year + "0101"
    endDate = year + "1231"

    return getJSONBetweenDates(startDate, endDate)

@app.route('/searchMovie', methods=['GET', 'POST'])
@requireApiKey
def searchMovie():
    apiKey = request.values.get('apiKey')
    jsonDict = json.loads(request.values.get('json'))

    title = urllib.parse.quote_plus(jsonDict["title"])
    url = "https://private.omdbapi.com/?apiKey=%s&s=%s&type=movie" % (omdbApiKey, title)

    response = urllib.request.urlopen(url)
    data = json.loads(response.read())
    return data

@app.route('/getMovieDetails', methods=['GET', 'POST'])
@requireApiKey
def getMovieDetails():
    jsonDict = json.loads(request.values.get('json'))
    imdbID = jsonDict["imdbID"]
    url = "https://www.omdbapi.com/?apiKey=%s&i=%s" % (omdbApiKey, imdbID)

    response = urllib.request.urlopen(url)
    raw = response.read()
    data = json.loads(raw)

    existing = checkExistingInfo(imdbID)

    if(not existing["firstViewing"]):
        data["firstViewing"] = False
        data["previousGenre"] = existing["movieGenre"]
    else:
        data["firstViewing"] = True

    return data

@app.route('/newEntry', methods=['GET', 'POST'])
@requireApiKey
def newEntry():
    jsonDict = json.loads(request.values.get('json'))

    movieTitle = jsonDict["movieTitle"]
    viewingDate = jsonDict["viewingDate"]

    viewingDate = dateutil.parser.parse(viewingDate).date().isoformat()

    movieURL = jsonDict["movieURL"]
    viewFormat = jsonDict["viewFormat"]
    viewLocation = jsonDict["viewLocation"]
    movieGenre = jsonDict["movieGenre"]
    movieReview = jsonDict["movieReview"]
    firstViewing = jsonDict["firstViewing"]

    firstViewingInt = 0
    if(firstViewing == True):
        firstViewingInt = 1

    conn.reconnect()
    c = conn.cursor()

    try:
        c.execute("INSERT INTO movies (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewing) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", (movieTitle, viewingDate, movieURL, viewFormat, viewLocation, movieGenre, movieReview, firstViewingInt) ) 
        conn.commit()
        return('{"OK": "Success"}')
    except mysql.connector.errors.OperationalError:
        return('{"Error": "Param Error"}')
        conn.rollback()


@app.route('/exportLetterboxd', methods=['GET', 'POST'])
@requireApiKey
def exportLetterboxd():
    c = conn.cursor()
    c.execute('SELECT movieTitle,movieURL,viewingDate,firstViewing,movieReview FROM movies WHERE movieURL LIKE "%imdb%"')

    rows = []

    for row in c:
        o = {}
        o["Title"] = row[0]
        imdbID = re.match(r".*(tt[0-9]*).*", row[1]).groups()[0]
        o["imdbID"] = imdbID
        o["WatchedDate"] = row[2].isoformat()
        if(row[3] == 1):
            o["Rewatch"] = False
        else:
            o["Rewatch"] = True
        o["Review"] = row[4]
        rows.append(o);

    return json.dumps(rows)
        
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

def checkExistingInfo(imdbID):
    result = {"firstViewing": True}

    conn.reconnect()
    c = conn.cursor()
    c.execute('SELECT movieTitle,movieGenre FROM movies WHERE movieURL LIKE "%' + str(imdbID) + '%"')

    for row in c:
        result["firstViewing"] = False
        result["movieGenre"] = str(row[1])
        break

    return result

