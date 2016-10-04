'use strict';

var fs = require('fs');
var storj = require('storj');
var dataDir = process.env.DATA_DIR || __dirname + '/.storjcli';
var bridgeURL = process.env.BRIDGE_URL || 'https://api.storj.io';

var createDataDir = function(dir, callback) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    return callback();
  }

  callback();
};

var resolveBucketRef = function(bucketRef, callback) {
  // Determine if we have a bucket name or bucketid
  var client = this;
  var bucketId = bucketRef;
  var isValidBucketId = new RegExp('^[0-9a-fA-F]{24}$');
  var referenceById = isValidBucketId.test(bucketRef);

  if (!referenceById) {
    // Get a list of buckets
    client.getBuckets(function(err, bucketObjects) {
      if (err) {
        return callback(err);
      }

      if (!bucketObjects.length) {
        return callback({ message: 'You have not created any buckets.' });
      }

      var foundBucket = false;

      // Check to see if there is a bucket by this name
      bucketObjects.forEach(function(bucketObject) {
        if (bucketObject.name === bucketRef) {
          foundBucket = true;

          bucketId = bucketObject.id;
        }
      });

      if (!foundBucket) {
        return callback({ message: 'Could not find the requested bucket' });
      }

      return callback(null, bucketId);
    });
  } else {
    return callback(null, bucketId);
  }
};

var resolveFileRef = function(bucketId, fileRef, callback) {
  // Determine if we have a file name or file id
  var client = this;
  var fileId = fileRef;

  client.listFilesInBucket(bucketId, function(err, files) {
    if (err) {
      return callback(err);
    }

    if (!files.length) {
      return callback({ message: 'No files found in bucket' });
    }

    var foundFile = false;

    // Check to see if there is a bucket by this name
    files.forEach(function(file) {
      if (file.filename === fileRef) {
        foundFile = true;
        fileId = file.id;
      }
    });

    if (!foundFile) {
      return callback({ message: 'Could not find the requested file' });
    }

    callback(null, fileId);
  });
};

var getFilenameIndex = function(client, bucketId, callback) {
  client.listFilesInBucket(bucketId, function(err, files) {
    if (err) {
      return console.log('Error listing files in bucket: ', err);
    }

    if (!files || files.length === 0) {
      console.log('No files in bucket');
      return callback([]);
    }

    var count = 0;
    var fileCount = files.length;
    var fileNameIndex = [];

    while ( count < fileCount ) {
      var file = files[count];
      fileNameIndex[file.filename] = file;

      count++;

      if (count === fileCount) {
        callback(fileNameIndex);
      }
    }
  });
};

var checkForBucketName = function(client, bucketReference, callback) {
  // Determine if we have a bucket name or bucketid
  var bucketId = null;
  var isValidBucketId = new RegExp('^[0-9a-fA-F]{24}$');
  var referenceById = isValidBucketId.test(bucketReference);

  if (!referenceById) {
    // Get a list of buckets
    client.getBuckets(function(err, bucketObjects) {
      if (err) {
        return callback(err.message);
      }

      if (!bucketObjects.length) {
        return callback('You have not created any buckets.');
      }

      var foundBucket = false;

      bucketObjects.forEach(function(bucketObject) {
        if (bucketObject.name === bucketReference) {
          foundBucket = true;

          bucketId = bucketObject.id;
        }
      });

      if (!foundBucket) {
        return callback('Could not find the requested bucket');
      }

      callback(err, bucketId);
    });
  }
};

var getBucketList = function(client, callback) {
  client.getBuckets(function(err, buckets) {
    if (err) {
      return console.log('error', err.message);
    }

    if (!buckets.length) {
      return console.log('warn', 'I can\'t seem to find any buckets...');
    }

    return callback(buckets);
  });
};

var createBucketnameIndex = function(buckets, callback) {
  var bucketnameIndex = {};

  buckets.forEach(function(bucket) {
    bucketnameIndex[bucket.name] = bucket.id;
  });

  return callback(bucketnameIndex);
};

var getKeyRing = function(password, callback) {
  // Check to make sure dataDir exists and create it if it doesnt
  var keyring = null;
  console.log('Creating data dir');
  createDataDir(dataDir, function() {
    console.log('Creating key ring');
    try {
      keyring = storj.KeyRing(dataDir, password);
    } catch(err) {
      return console.log('Error creating keyring: %s', err);
    }
    console.log('Key ring created');
    return callback(keyring);
  });
};

var createBucket = function(client, name, callback) {
  var bucketInfo = {
    name: name,
    storage: 30,
    transfer: 10
  };

  console.log('Attempting to create bucket \'%s\'', name);

  client.createBucket(bucketInfo, function(err, bucket) {
    if (err) {
      return console.log('error', err.message);
    }

    return callback(bucket.id);
  });
};

var uploadFile = function(client, bucketId, filePath, password, callback) {
  // Prepare to encrypt file for upload
  var tmppath = filePath + '.crypt';
  var secret = new storj.DataCipherKeyIv();
  var encrypter = new storj.EncryptStream(secret);
  var writeStream = fs.createWriteStream(tmppath, { autoClose: true });

  console.log('Uploading file ', filePath);

  fs.createReadStream(filePath).pipe(encrypter).pipe(writeStream);

  getKeyRing(password, function(keyring) {
    writeStream.on('finish', function() {
      client.createToken(bucketId, 'PUSH', function(err, token) {
        if (err) {
          return console.log('Error getting token: %s', err);
        }

        console.log('Created token');
        console.log('Storing file in bucket');

        client.storeFileInBucket(bucketId, token.token, tmppath, function(err, file) {
          if (err) {
            return console.log('Error storing file in bucket: %s', err);
          }

          console.log('File uploaded...');

          keyring.set(file.id, secret);
          return callback(null, file.id);
        });
      });
    });
  });
};

var getDecrypter = function(fileId, password, callback) {
  getKeyRing(password, function(keyring) {
    var secret = keyring.get(fileId);
    var decrypter = new storj.DecryptStream(secret);

    callback(decrypter);
  });
};

var getFileStreamByName = function(client, options, callback) {
  var filename = options.filename;
  var bucketname = options.bucketname;
  var password = options.password;

  // Get the bucketid
  getBucketList(client, function(bucketList) {
    // Get the fileid
    createBucketnameIndex(bucketList, function(bucketnameIndex) {
      var bucketId = bucketnameIndex[bucketname];

      // get the file stream
      getFilenameIndex(client, bucketId, function(filenameIndex) {
        if (!filenameIndex || !filenameIndex[filename]) {
          return callback('File not found');
        }

        var fileId = filenameIndex[filename].id;

        getDecrypter(fileId, password, function(decrypter) {
          // decrypt the file
          client.createFileStream(bucketId, fileId, function(err, stream) {
            if (err) {
              console.log('Error creating file stream: ', err);
              return callback(err);
            }
            stream.pipe(decrypter).pause();

            return callback(null, stream);
          });
        });
      });
    });
  });
};

var getContentType = function(filename, callback) {

};

var getBasicAuthClient = function getBasicAuthClient(options, callback) {
  var logger = storj.deps.kad.Logger();
  // Change to 1-4 to see logs from Storj
  // 4 being the highest level of logging
  logger.level = options.logLevel || 0;
  options.logger = logger;
  var client = new storj.BridgeClient(bridgeURL, options);
  console.log('Created Storj client');

  console.log('This device has been successfully paired.');
  return callback(client);
};

module.exports = {
  getFilenameIndex: getFilenameIndex,
  getBucketList: getBucketList,
  createBucketnameIndex: createBucketnameIndex,
  checkForBucketName: checkForBucketName,
  getKeyRing: getKeyRing,
  createBucket: createBucket,
  uploadFile: uploadFile,
  getDecrypter: getDecrypter,
  getFileStreamByName: getFileStreamByName,
  getContentType: getContentType,
  getBasicAuthClient: getBasicAuthClient,
  resolveBucketRef: resolveBucketRef,
  resolveFileRef: resolveFileRef
};
