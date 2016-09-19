'use strict';

var expect = require('chai').expect;
var utils = require('../lib/utils');
var proxyquire = require('proxyquire');
var sinon = require('sinon');

describe('utils', function() {

  describe('#getFilenameIndex', function() {

    it('should return a file list mapped by filename', function() {
      expect(utils.getFilenameIndexs({
        blah: "blah"
      })).to.equal(
        'asdf'
      );
    });
  });
});
