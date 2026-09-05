-- Initial schema for moviething
CREATE TABLE IF NOT EXISTS movies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  movieTitle VARCHAR(255),
  viewingDate DATE,
  movieURL VARCHAR(255),
  viewFormat VARCHAR(64),
  viewLocation VARCHAR(128),
  firstViewing TINYINT(1),
  movieGenre VARCHAR(64),
  movieReview TEXT
);



