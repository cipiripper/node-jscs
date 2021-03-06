var hooker = require('hooker');
var sinon = require('sinon');
var glob = require('glob');
var assert = require('assert');
var Vow = require('vow');
var hasAnsi = require('has-ansi');

var path = require('path');

var cli = require('../lib/cli');
var startingDir = process.cwd();

describe('modules/cli', function() {
    beforeEach(function() {
        sinon.stub(process, 'exit');
        sinon.stub(process.stdout, 'write');
        sinon.stub(process.stderr, 'write');
    });
    afterEach(function() {
        process.chdir(startingDir);
        process.exit.restore();

        // If stdin rewrites were not used, restore them here
        rAfter();
    });

    // Can't do it in afterEach hook, because otherwise name of the test would not be printed
    function rAfter() {
        if (process.stdout.write.restore) {
            process.stdout.write.restore();
        }

        if (process.stderr.write.restore) {
            process.stderr.write.restore();
        }
    }

    it('should provide friendly error message if config is corrupted', function() {
        sinon.spy(console, 'error');

        var result = cli({
            config: path.resolve(process.cwd(), './test/data/configs/json/corrupted.json'),
        });

        return result.promise.fail(function() {
            assert(console.error.getCall(0).args[0] === 'Config source is corrupted -');
            console.error.restore();
        });
    });

    it('should throw error if preset does not exist', function() {
        sinon.spy(console, 'error');

        var result = cli({
            preset: 'not-exist'
        });

        return result.promise.fail(function() {
            assert(console.error.getCall(0).args[0] === 'Preset "not-exist" does not exist');
            console.error.restore();
        });
    });

    it('should correctly exit if no files specified', function() {
        hooker.hook(console, 'error', {
            pre: function(message) {
                assert.equal(message, 'No input files specified. Try option --help for usage information.');

                return hooker.preempt();
            },
            once: true
        });

        cli({
            args: []
        });
    });

    it('should exit if no custom config is found', function() {
        hooker.hook(console, 'error', {
            pre: function(arg1, arg2, arg3) {
                assert.equal(arg1, 'Configuration source');
                assert.equal(arg2, 'config.js');
                assert.equal(arg3, 'was not found.');

                process.chdir('../');

                return hooker.preempt();
            },
            once: true
        });

        process.chdir('./test/');

        var result = cli({
            config: 'config.js'
        });

        assert(typeof result === 'object');
    });

    it('should set presets', function() {
        var Checker = require('../lib/checker');
        var old = Checker.prototype.checkPath;

        Checker.prototype.checkPath = function(path) {
            assert(path, 'test/data/cli/success.js');

            Checker.prototype.checkPath = old;

            return Vow.defer().promise();
        };

        var result = cli({
            args: ['test/data/cli/success.js'],
            preset: 'jquery',
            config: 'test/data/cli/cli.json'
        });

        assert(result.checker.getProcessedConfig().requireCurlyBraces);
    });

    it('should bail out if no inputs files are specified', function() {
        var result = cli({
            args: ['']
        });

        return result.promise.fail(function(status) {
            assert(status);
            rAfter();
        });
    });

    describe('verbose option', function() {
        beforeEach(function() {
            sinon.spy(console, 'log');
        });

        it('should not display rule names in error output by default', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                config: 'test/data/cli/cli.json'
            });

            return result.promise.fail(function() {
                assert(console.log.getCall(0).args[0].indexOf('disallowKeywords:') === -1);
                console.log.restore();
            });
        });

        it('should display rule names in error output with verbose option', function() {
            var result = cli({
                verbose: true,
                args: ['test/data/cli/error.js'],
                config: 'test/data/cli/cli.json'
            });

            return result.promise.fail(function() {
                assert(console.log.getCall(0).args[0].indexOf('disallowKeywords:') === 0);
                console.log.restore();
            });
        });
    });

    describe('reporter option', function() {
        it('should set implicitly set checkstyle reporter', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                config: 'test/data/cli/cli.json'
            });

            return result.promise.always(function() {
                assert(path.basename(result.reporter), 'checkstyle');
                rAfter();
            });
        });

        it('should set implicitly set text reporter', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                'no-colors': true,
                config: 'test/data/cli/cli.json'
            });

            return result.promise.always(function() {
                assert(path.basename(result.reporter), 'text.js');
                rAfter();
            });
        });

        it('should set reporter through relative path', function() {
            process.chdir('test');

            var result = cli({
                args: ['test/data/cli/error.js'],
                reporter: '../lib/reporters/junit.js',
                config: 'test/data/cli/cli.json'
            });

            return result.promise.always(function() {
                assert(path.basename(result.reporter), 'junit.js');
                rAfter();
            });
        });

        it('should set reporter through absolute path', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                reporter: path.resolve(process.cwd(), 'lib/reporters/junit.js'),
                config: 'test/data/cli/cli.json'
            });

            return result.promise.always(function() {
                assert(path.basename(result.reporter), 'junit.js');
                rAfter();
            });
        });

        it('should set reporter name of pre-defined reporter', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                reporter: 'text',
                config: 'test/data/cli/cli.json'
            });

            return result.promise.always(function() {
                assert(path.basename(result.reporter), 'text.js');
                rAfter();
            });
        });

        it('should return exit if no reporter is found', function() {
            var result = cli({
                args: ['test/data/cli/error.js'],
                reporter: 'does not exist',
                config: 'test/data/cli/cli.json'
            });

            return result.promise.fail(function(status) {
                assert(status.valueOf());
                rAfter();
            });
        });

        describe('reporters exit statuses', function() {
            var rname = /\/(\w+)\.js/;

            // Testing pre-defined reporters with names
            glob.sync(path.resolve(process.cwd(), 'lib/reporters/*.js')).map(function(path) {
                var name = path.match(rname)[1];

                it('should return fail exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/error.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.fail(function(status) {
                        assert(status.valueOf());
                        rAfter();
                    });
                });

                it('should return successful exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/success.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.then(function(status) {
                        assert(!status.valueOf());
                        rAfter();
                    });
                });
            });

            // Testing reporters with absolute paths
            glob.sync(path.resolve(process.cwd(), 'lib/reporters/*.js')).map(function(path) {
                var name = path.match(rname).input;

                it('should return fail exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/error.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.fail(function(status) {
                        assert(status.valueOf());
                        rAfter();
                    });
                });

                it('should return successful exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/success.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.then(function(status) {
                        assert(!status.valueOf());
                        rAfter();
                    });
                });
            });

            // Testing reporters with relative paths
            glob.sync(path.resolve(process.cwd(), 'lib/reporters/*.js')).map(function(filepath) {
                var name = 'lib/reporters' + filepath.match(rname)[0];

                it('should return fail exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/error.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.fail(function(status) {
                        assert(status.valueOf());
                        rAfter();
                    });
                });

                it('should return successful exit code for "' + name + '" reporter', function() {
                    return cli({
                        args: ['test/data/cli/success.js'],
                        reporter: name,
                        config: 'test/data/cli/cli.json'
                    }).promise.then(function(status) {
                        assert(!status.valueOf());
                        rAfter();
                    });
                });
            });

        });
    });

    describe('colors option', function() {
        beforeEach(function() {
            sinon.spy(console, 'log');
        });

        afterEach(function() {
            console.log.restore();
        });

        it('should not have colors output', function() {
            var result = cli({
                colors: false,
                args: ['test/data/cli/error.js'],
                config: 'test/data/cli/cli.json'
            });

            return result.promise.fail(function() {
                assert(!hasAnsi(console.log.getCall(0).args[0]));
            });
        });

        it('should have colors output', function() {
            var result = cli({
                colors: true,
                args: ['test/data/cli/error.js'],
                config: 'test/data/cli/cli.json'
            });

            return result.promise.fail(function() {
                assert(hasAnsi(console.log.getCall(0).args[0]));
            });
        });
    });
});
