const debug = require('debug')('geo:user');
var express = require('express');
var router = express.Router();
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const User = require('../models/user');
const utils = require('./utils');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const secretKey = process.env.SECRET_KEY || 'changeme';

/**
 * @api {post} /api/users Create a user
 * @apiName CreateUser
 * @apiGroup User
 * @apiVersion 1.0.0
 * @apiDescription Registers a new user.
 *
 * @apiUse UserInRequestBody
 * @apiUse UserInResponseBody
 * @apiUse UserValidationError
 * @apiSuccess (Response body) {String} id A unique identifier for the user generated by the server
 *
 * @apiExample Example
 *     POST /api/users HTTP/1.1
 *     Content-Type: application/json
 *
 *     {
 *       "username": "JeanPaul",
 *       "password": "mypassword"
  *     }
 *
 * @apiSuccessExample 201 Created
 *     HTTP/1.1 201 Created
 *     Content-Type: application/json
 *     Location: https://comem-archioweb-2019-2020-g.herokuapp.com/api/users/58b2926f5e1def0123e97281
 *
 *     
 *     {
 *       "_id": "5dc6b5f84080dc5e74951c66",
 *       "username": "meme",
 *       "created_at": "2019-11-09T13:19:37.568Z",
 *       "totalScore": 120,
 *       "maxScore": 10,
 *       "averageScore": 10
 *   },
 */

router.post('/', function(req, res, next) {
  bcrypt.hash(req.body.password, 10, function(err, hashedPassword) {
    if (err) {
      return next(err);
    }

    // Create a new document from the JSON in the request body
    const newUser = new User(req.body);
    newUser.password = hashedPassword;
    // Save that document
    newUser.save(function(err, savedUser) {
      if (err) {
        return next(err);
      }
      // Send the saved document in the response
      res.send(savedUser);
    });
  });
});


/**
 * @api {get} /api/users List existing users
 * @apiName RetrieveUsers
 * @apiGroup User
 * @apiVersion 1.0.0
 * @apiDescription Retrieves a paginated list of users with their respective scores.
 *
 * @apiUse UserInResponseBody
 * @apiUse UserIncludes
 * @apiUse Pagination
 *
 * @apiParam (URL query parameters) {String} [directorId] Select only movies directed by the person with the specified ID (this parameter can be given multiple times)
 * @apiParam (URL query parameters) {Number} [rating] Select only movies with the specified rating (exact match)
 * @apiParam (URL query parameters) {Number} [ratedAtLeast] Select only movies with a rating greater than or equal to the specified rating
 * @apiParam (URL query parameters) {Number} [ratedAtMost] Select only movies with a rating lesser than or equal to the specified rating
 *
 * @apiExample Example
 *     GET /api/movies?directorId=58b2926f5e1def0123e97bc0&page=2&pageSize=50 HTTP/1.1
 *
 * @apiSuccessExample 200 OK
 *     HTTP/1.1 200 OK
 *     Content-Type: application/json
 *     Link: &lt;https://evening-meadow-25867.herokuapp.com/api/movies?page=1&pageSize=50&gt;; rel="first prev"
 *
 *     [
 *       {
 *         "id": "58b2926f5e1def0123e97281",
 *         "title": "Die Hard",
 *         "rating": 7.4,
 *         "directorId": "58b2926f5e1def0123e97bc0",
 *         "createdAt": "1988-07-12T00:00:00.000Z"
 *       },
 *       {
 *         "id": "58b2926f5e1def0123e97282",
 *         "title": "Die Hard With a Vengance",
 *         "rating": 8.3,
 *         "directorId": "58b2926f5e1def0123e97bc0",
 *         "createdAt": "1995-05-19T00:00:00.000Z"
 *       }
 *     ]
 */

router.get('/', function(req, res, next) {

  const countQuery = queryUsers(req);
  countQuery.countDocuments(function(err, total) {
    if (err) {
      return next(err);
    }

    // Parse pagination parameters from URL query parameters.
    const { page, pageSize } = utils.getPaginationParameters(req);

    User.aggregate([
      {
        $lookup: {
          from: 'guesses',
          localField: '_id',
          foreignField: 'user_id',
          as: 'obtainedScores',
        }
      },
      {
        $unwind: '$obtainedScores'
      },
      {
        $group: {
          _id: '$_id',
          username: { $first: '$username' },
          createdAt: { $first: '$createdAt' },
          totalScore: { $sum: '$obtainedScores.score' },
          maxScore: { $max: '$obtainedScores.score' },
          averageScore: { $avg: "$obtainedScores.score" }
        }
      },
      {
        $sort: {
          obtainedScores: 1
        }
      },
      {
        $skip: (page - 1) * pageSize
      },
      {
        $limit: pageSize
      }
    ], (err, users) => {
      if (err) {
        return next(err);
      }

      utils.addLinkHeader('/api/users', page, pageSize, total, res);

      res.send(users.map(user => {

        // Transform the aggregated object into a Mongoose model.
        const serialized = new User(user).toJSON();

        // Add the aggregated property.
        serialized.totalScore = user.totalScore;
        serialized.maxScore = user.maxScore;
        serialized.averageScore = user.averageScore;

        return serialized;
      }));
    });
  });
});

/* GET retrieve a user */
router.get('/:id', loadUserFromParamsMiddleware, function(req, res, next) {
    res.send({
      ...req.user.toJSON()
    });
  });

/* PATCH a user */
router.patch('/:id', utils.requireJson, loadUserFromParamsMiddleware, function(req, res, next) {

  // Update properties present in the request body
  if (req.body.username !== undefined) {
    req.user.username = req.body.username;
  }
  if (req.body.password !== undefined) {
    req.user.password = req.body.password;
  }

  req.user.save(function(err, savedUser) {
    if (err) {
      return next(err);
    }

    debug(`Updated user "${savedUser.username}"`);
    res.send(savedUser);
  });
});

/* DELETE a user */
router.delete('/:id', loadUserFromParamsMiddleware, utils.authenticate, function(req, res, next) {
    req.user.remove(function(err) {
      if (err) {
        return next(err);
      }

      debug(`Deleted user "${req.user.username}"`);
      res.sendStatus(204);
    });
  });

/* Register a user */
router.post('/register', function(req, res, next){
  User.find({ username: req.body.username })
  .exec()
  .then(user => {
    if (user.length >= 1) {
      return res.status(409).json({
        message: "Username already exists"
      });
    } else {
      bcrypt.hash(req.body.password, 10, (err, hashedPassword) => {
        if (err) {
          return next(err);
        } else {
          const user = new User({
            _id: new mongoose.Types.ObjectId(),
            username: req.body.username,
            password: hashedPassword
          });
          user.save(function(err, savedUser) {
            if (err) {
              return next(err);
            }
            debug(`User "${savedUser.username}" created`);
            res.send(savedUser);
          });
        }
      });
    }
  });
});

/* Authenticate a user */
router.post('/login', function(req, res, next) {
  User.findOne({ username: req.body.username }).exec(function(err, user) {
    if (err) {
      return next(err);
    } else if (!user) {
      return res.sendStatus(401);
    }
    bcrypt.compare(req.body.password, user.password, function(err, valid) {
      if (err) {
        return next(err);
      } else if (!valid) {
        return res.sendStatus(401);
      }
      const exp = (new Date().getTime() + 7 * 24 * 3600 * 1000) / 1000;
      const claims = { sub: user._id.toString(), exp: exp };
      jwt.sign(claims, secretKey, function(err, token) {
        if (err) { return next(err); }
        res.send({ token: token }); // Send the token to the client.
      });
    });
  })
});

/**
 * Middleware that loads the user corresponding to the ID in the URL path.
 * Responds with 404 Not Found if the ID is not valid or the user doesn't exist.
 */
function loadUserFromParamsMiddleware(req, res, next) {

  const userId = req.params.id;
  if (!ObjectId.isValid(userId)) {
    return userNotFound(res, userId);
  }

  User.findById(req.params.id, function(err, user) {
    if (err) {
      return next(err);
    } else if (!user) {
      return userNotFound(res, userId);
    }

    req.user = user;
    next();
  });
}

/**
 * Responds with 404 Not Found and a message indicating that the user with the specified ID was not found.
 */
function userNotFound(res, userId) {
  return res.status(404).type('text').send(`No user found with ID ${userId}`);
}

function queryUsers(req) {

  let query = User.find();

 /** if (String(req.query.username)) {
    const usernames = req.query.username;
    query = query.where('username').in(usernames);
  } */

  return query;
}

module.exports = router;