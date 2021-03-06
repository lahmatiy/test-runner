var utils = require('./utils.js');
var getTime = require('basis.utils.benchmark').time;

var ERROR_TEST_FAULT = 'ERROR_TEST_FAULT';
var ERROR_TEST_CRASH = 'ERROR_TEST_CRASH';
var ERROR_TIMEOUT = 'ERROR_TIMEOUT';

var DEFAULT_TIMEOUT = 250;

module.exports = function createAssert(scope, testCode, settings){
  // var warnMessages = [];
  // var errorMessages = [];
  var time = NaN;
  var startTime;
  var timeoutTimer;
  var processAsyncTimer;
  var async = settings.async ? 1 : 0;
  var asyncQueue = [];
  var visitPoints;
  var assertNode = null;
  var isForNum = 0;
  var implicitCompare;
  var actual_;
  var expected_;
  var runDoneCallback;
  var runBreakAssert;

  var report = {
    time: time,
    lastLine: 0,

    pending: false,
    successCount: 0,
    testCount: 0,

    error: null,
    exception: null,
    errorLines: {},
    warns: null
  };

  var testDone = function(error){
    time = getTime(startTime);
    timeoutTimer = scope.clearTimeout(timeoutTimer);
    processAsyncTimer = scope.clearTimeout(processAsyncTimer);
    asyncQueue.length = 0;
    async = 0;

    if (!error && report.testCount !== report.successCount)
      error = ERROR_TEST_FAULT;

    basis.object.extend(report, {
      time: time,
      error: error,
      pending: !error && !report.testCount,
      warns: null //warnMessages.length ? warnMessages : null
    });

    runDoneCallback(report);
  };

  var addLineAnnotation = function(annotation){
    var line = assertNode ? assertNode.line : 'noline';
    var errors = report.errorLines[line];

    if (!errors)
      errors = report.errorLines[line] = [];

    errors.push(annotation);
  };

  var visit = function(value){
    visitPoints.push(value);
  };
  visit.reset = function(){
    visitPoints.length = 0;
  };
  visit.wrong = function(){
    report.testCount++;
    addLineAnnotation({
      type: 'message',
      message: 'Shouldn\'t visit this place'
    });
  };
  visit.wrap = function(host, method){
    var fn = host[method];
    host[method] = function(arg){
      visit(arg);
      return fn.apply(this, arguments);
    };
  };
  visit.list = function(){
    return visitPoints.slice();
  };

  var assert = function(expected, actual, deep){
    var error;

    if (arguments.length == 1)
    {
      error = utils.isTruthy(expected);
      if (implicitCompare)
      {
        actual = actual_;
        expected = expected_;
      }
      else
      {
        actual = expected;
        expected = true;
      }
    }
    else
    {
      error = utils.compareValues(expected, actual, deep);
    }

    if (error)
    {
      addLineAnnotation({
        type: 'compare',
        num: report.testCount,
        debug: isForNum,
        node: assertNode,
        error: error,
        expected: utils.makeStaticCopy(expected),
        expectedStr: utils.value2string(expected, false, deep),
        actual: utils.makeStaticCopy(actual),
        actualStr: utils.value2string(actual, false, deep)
      });
    }

    implicitCompare = false;
    actual_ = undefined;
    expected_ = undefined;

    report.successCount += !error;
    report.testCount++;
  };

  assert.is = assert; // DEPRECATED: remove in future
  assert.visited = function(expectedPoints){
    assert.deep(expectedPoints, visitPoints);
  };
  assert.deep = function(expected, actual){
    assert(expected, actual, true);
  };
  assert.async = function(fn){
    asyncQueue.push(fn);
    __processAsync();
  };
  assert.exception =
  assert.throws = function(fn){
    try {
      report.exception = true;
      fn();
      assert(false);
    } catch(e) {
      assert(true);
    } finally {
      report.exception = false;
    }
  };

  var __actual = function(operator, value){
    implicitCompare = operator;
    actual_ = value;
    return value;
  };
  var __expected = function(value){
    expected_ = value;
    return value;
  };

  var __isFor = function(start, end, line){
    report.lastLine = line;
    assertNode = {
      range: [start, end],
      line: line
    };
    return ++isForNum === runBreakAssert;
  };

  var __enterLine = function(line){
    report.lastLine = line;
  };

  var __wrapFunctionExpression = function(fn, orig){
    fn.originalFn_ = orig;
    return fn;
  };

  var __exception = function(e){
    if (report.exception)
      return;

    report.exception = e;
    report.testCount = 0;
    report.successCount = 0;

    testDone(ERROR_TEST_CRASH);
  };

  var __processAsync = function(){
    scope.clearTimeout(timeoutTimer);

    if (asyncQueue.length)
    {
      if (processAsyncTimer)
        return;

      processAsyncTimer = scope.setTimeout(function(){
        processAsyncTimer = undefined;

        try {
          asyncQueue.shift().call();
          __processAsync();
        } catch(e) {
          __exception(e);
        }
      }, 0);
    }
    else if (async === 0)
    {
      testDone();
    }
    else
    {
      timeoutTimer = scope.setTimeout(function(){
        testDone(ERROR_TIMEOUT);
      }, settings.timeout || DEFAULT_TIMEOUT);
    }
  };

  var __asyncDone = function(){
    if (!async)
      return;

    async--;
    if (!async && !asyncQueue.length)
      testDone();
  };


  var asyncDone = async
    ? basis.fn.runOnce(__asyncDone)
    : function(){};

  return function(breakAssert, callback){
    runDoneCallback = callback.bind(this);
    runBreakAssert = breakAssert;

    if (settings.pending)
      return testDone();

    // prepare env and run test
    scope.run(testCode, null, function(testFn){
      startTime = getTime();

      // prepare args
      var args = async ? [asyncDone] : [];
      args.push(
        assert,
        visit,
        __isFor,
        __enterLine,
        __exception,
        __wrapFunctionExpression,
        __actual,
        __expected
      );

      visitPoints = new scope.Array();

      // run test
      try {
        var testResult = testFn.apply(assert, args);

        if (testResult && typeof testResult.then === 'function')
        {
          async++;
          testResult.then(__asyncDone, __exception);
        }
      } catch(e) {
        return __exception(e);
      }

      if (!asyncQueue.length)
      {
        if (async)
        {
          timeoutTimer = scope.setTimeout(function(){
            testDone(ERROR_TIMEOUT);
          }, settings.timeout || DEFAULT_TIMEOUT);
        }
        else
          testDone();
      }
    });
  };
};
