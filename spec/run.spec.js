'use strict';

const run = require('../lib/run');
const assert = require('assert');
const nock = require('nock');
const fs = require('fs');
const path = require('path');
const moment = require('moment');


describe('cli', () => {
  let log;
  const cons = {};
  let streams;
  const TESTS = [[], [], ['--dry']];
  const ISSUES = ['issues', 'issues_default_title', 'issues'];

  beforeEach(() => {
    replaceConsole();
    process.stdin.setEncoding('utf8');
    log = '';
    streams = ['input.tap', 'input_no_comments.tap', 'input.tap']
              .map(file => fs.createReadStream(path.join(__dirname, 'fixtures', file)));
  });

  afterEach(() => {
    restoreConsole();
    nock.cleanAll();
  });

  TESTS.map((args, i) => {
    it(`should create issue #${i}`, () => {
      mockIssues([]);
      if (!dryMode(args)) mock('post', '/repos/MailOnline/videojs-vast-vpaid/issues', './fixtures/create_issue.json');

      return ok(run(['-l', 'ghlint'].concat(args), streams[i], false))
      .then(() => {
        const lines = log.split('\n');
        assert.equal(lines.length, 5);
        assert(/^not ok \(creating/.test(lines[1]));
        assert(/^ok \(no issue/.test(lines[2]));
        assert.equal(lines[3], 'passed 1 out of 2');
        assert.equal(lines[4], 'issues: 1 new, 0 closed, 0 re-opened, 0 reminded');
        assert(nock.isDone());
      });
    });
  });

  TESTS.map((args, i) => {
    it(`should close issue #${i}`, () => {
      mockIssues(`./fixtures/${ISSUES[i]}_1.json`);
      if (!dryMode(args)) {
        mock('post', '/repos/MailOnline/videojs-vast-vpaid/issues/2/comments', {}); // add comment
        mock('patch', '/repos/MailOnline/videojs-vast-vpaid/issues/2', {}); // close issue
      }

      return ok(run(['-l', 'ghlint'].concat(args), streams[i], false))
      .then(() => {
        const lines = log.split('\n');
        assert.equal(lines.length, 5);
        assert(/^not ok \(recent/.test(lines[1]));
        assert(/^ok \(closing/.test(lines[2]));
        assert.equal(lines[3], 'passed 1 out of 2');
        assert.equal(lines[4], 'issues: 0 new, 1 closed, 0 re-opened, 0 reminded');
        assert(nock.isDone());
      });
    });
  });

  TESTS.map((args, i) => {
    it(`should re-open issue #${i}`, () => {
      mockIssues(`./fixtures/${ISSUES[i]}_2.json`);
      if (!dryMode(args)) {
        mock('post', '/repos/MailOnline/videojs-vast-vpaid/issues/1/comments', {}); // add comment
        mock('patch', '/repos/MailOnline/videojs-vast-vpaid/issues/1', {}); // re-open issue
      }

      return ok(run(['-l', 'ghlint'].concat(args), streams[i], false))
      .then(() => {
        const lines = log.split('\n');
        assert.equal(lines.length, 5);
        assert(/^not ok \(re-opening/.test(lines[1]));
        assert(/^ok \(resolved/.test(lines[2]));
        assert.equal(lines[3], 'passed 1 out of 2');
        assert.equal(lines[4], 'issues: 0 new, 0 closed, 1 re-opened, 0 reminded');
        assert(nock.isDone());
      });
    });
  });

  TESTS.map((args, i) => {
    it(`should remind about the issue #${i}`, () => {
      const issues = require(`./fixtures/${ISSUES[i]}_3.json`);
      issues[0].updated_at = moment().subtract(10, 'days').toISOString();
      mockIssues(issues);
      if (!dryMode(args)) mock('post', '/repos/MailOnline/videojs-vast-vpaid/issues/1/comments', {}); // add comment

      return ok(run(['-l', 'ghlint'].concat(args), streams[i], false))
      .then(() => {
        const lines = log.split('\n');
        assert.equal(lines.length, 5);
        assert(/^not ok \(reminding/.test(lines[1]));
        assert(/^ok \(no issue/.test(lines[2]));
        assert.equal(lines[3], 'passed 1 out of 2');
        assert.equal(lines[4], 'issues: 0 new, 0 closed, 0 re-opened, 1 reminded');
        assert(nock.isDone());
      });
    });
  });

  TESTS.map((args, i) => {
    it(`should add comments to the issue with extended messages #${i}`, () => {
      const issues = require('./fixtures/issues_3.json');
      issues[0].updated_at = moment().subtract(10, 'days').toISOString();
      mockIssues(issues);
      const ISSUES_API = '/repos/MailOnline/videojs-vast-vpaid/issues';
      if (!dryMode(args)) {
        mock('post', ISSUES_API, './fixtures/create_issue.json');
        mock('get', `${ISSUES_API}/1/comments?per_page=30&page=1`, []);
        mock('post', `${ISSUES_API}/1/comments`, './fixtures/create_comment.json');
        mock('post', `${ISSUES_API}/1/comments`, './fixtures/create_comment.json');
      }

      const stream = fs.createReadStream(path.join(__dirname, 'fixtures', 'input_with_messages.tap'));

      return ok(run(['-l', 'ghlint'].concat(args), stream, false))
      .then(() => {
        const lines = log.split('\n');
        if (dryMode(args)) {
          assert.equal(lines.length, 5);
          assert(/^"dry" mode/, lines[0]);
          assert(/^not ok \(creating/.test(lines[1]));
          assert(/^2 comments \(adding/.test(lines[2]));
          assert.equal(lines[3], 'passed 0 out of 1');
          assert.equal(lines[4], 'issues: 1 new, 0 closed, 0 re-opened, 0 reminded');
        } else {
          assert.equal(lines.length, 6);
          assert(/^updating/, lines[0]);
          assert(/^not ok \(creating/.test(lines[1]));
          assert(/^comment \(adding/.test(lines[2]));
          assert(/^comment \(adding/.test(lines[3]));
          assert.equal(lines[4], 'passed 0 out of 1');
          assert.equal(lines[5], 'issues: 1 new, 0 closed, 0 re-opened, 0 reminded');
        }
        assert(nock.isDone());
      });
    });
  });

  it('should update issue labels if error severity changes with --severity option', () => {
    const issues = require('./fixtures/issues_3.json');
    issues[0].updated_at = moment().subtract(1, 'days').toISOString(); // no reminder
    mockIssues(issues);
    mock('put', '/repos/MailOnline/videojs-vast-vpaid/issues/1/labels', []);

    const stream = fs.createReadStream(path.join(__dirname, 'fixtures', 'input.tap'));

    return ok(run(['-l', 'ghlint', '--severity'], stream, false))
    .then(() => {
      const lines = log.split('\n');
      assert.equal(lines.length, 6);
      assert(/^updating/, lines[0]);
      assert(/^not ok \(recent/.test(lines[1]));
      assert(/^labels \(updating/.test(lines[2]));
      assert(/^ok \(no issue/.test(lines[3]));
      assert.equal(lines[4], 'passed 1 out of 2');
      assert.equal(lines[5], 'issues: 0 new, 0 closed, 0 re-opened, 0 reminded');
      assert(nock.isDone());
    });
  });

  it('should log warning if test case is invalid', () => {
    const stream = fs.createReadStream(path.join(__dirname, 'fixtures', 'input_invalid.tap'));

    return ok(run(['-l', 'ghlint'], stream, false))
    .then(() => {
      const lines = log.split('\n');
      assert.deepEqual(lines, [
        'updating GitHub issues',
        'skipping invalid test #0 (MailOnline/videojs-vast-vpaid: repo-description):',
        'test.diag should have required property \'rule\'',
        'test.diag.issue should have required property \'title\'',
        'passed 0 out of 1',
        'issues: 0 new, 0 closed, 0 re-opened, 0 reminded'
      ]);
      assert(nock.isDone());
    });
  });

  it('should throw if label is not passed', () => {
    return fail(run([], streams[0], false));
  });


  function mock(method, apiPath, data) {
    if (typeof data == 'string') data = require(data);
    nock('https://api.github.com')[method](apiPath).reply(200, data);
  }

  function mockIssues(data) {
    mock('get', '/repos/MailOnline/videojs-vast-vpaid/issues?labels=ghlint&state=all&per_page=30&page=1', data);
  }

  function replaceConsole() {
    eachCons(method => {
      cons[method] = console[method];
      console[method] = saveLog;
    });
  }

  function restoreConsole() {
    eachCons(method => {
      console[method] = cons[method];
    });
  }

  function dryMode(args) {
    return args.indexOf('--dry') >= 0;
  }

  function ok(p) {
    return p.then(restoreConsole, (e) => {
      restoreConsole();
      throw e;
    });
  }

  function fail(p) {
    return ok(p)
    .then(
      () => { throw new Error('should have thrown'); },
      () => {}
    );
  }

  function eachCons(func) {
    ['log', 'warn', 'error'].forEach(func);
  }

  function saveLog() {
    if (log) log += '\n';
    log += Array.prototype.join.call(arguments, ' ');
  }
});
