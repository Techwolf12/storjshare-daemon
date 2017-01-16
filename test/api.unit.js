'use strict';

const RPC = require('../lib/api');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const {expect} = require('chai');
const {Readable, Writable} = require('stream');
const {EventEmitter} = require('events');

describe('class:RPC', function() {

  describe('#_log', function() {

    it('should call the log method', function() {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let info = sinon.stub(rpc.logger, 'info');
      rpc._log('test');
      expect(info.called).to.equal(true);
    });

  });

  describe('#_processShareIpc', function() {

    it('should add the message to the meta.farmerState', function() {
      let rpc = new RPC();
      let share = { meta: {} };
      rpc._processShareIpc(share, { foo: 'bar' });
      expect(share.meta.farmerState.foo).to.equal('bar');
    });

  });

  describe('#start', function() {

    it('should callback error if no config given', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          statSync: sinon.stub().throws(new Error())
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.start('path/to/config', function(err) {
        expect(err.message).to.equal(
          'failed to read config at path/to/config'
        );
        done();
      });
    });

    it('should callback error if cannot parse config', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          statSync: sinon.stub(),
          readFileSync: sinon.stub().returns(Buffer.from('not json'))
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.start('path/to/config', function(err) {
        expect(err.message).to.equal(
          'failed to parse config at path/to/config'
        );
        done();
      });
    });

    it('should callback error if config invalid', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          statSync: sinon.stub(),
          readFileSync: sinon.stub().returns(Buffer.from('{}'))
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.start('path/to/config', function(err) {
        expect(err.message).to.equal('invalid payout address');
        done();
      });
    });

    it('should callback error if share running', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          statSync: sinon.stub(),
          readFileSync: sinon.stub().returns(Buffer.from(
            '{"networkPrivateKey":"02d2e5fb5a1fe74804bc1ae3b63bb130441' +
              'cc9b5c877e225ea723c24bcea4f3b"}'
          ))
        },
        './utils': {
          validate: sinon.stub()
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.shares.set('2c9e76f298cb3a023785be8985205d371580ba27', {
        readyState: 1
      });
      rpc.start('path/to/config', function(err) {
        expect(err.message).to.equal(
          'share 2c9e76f298cb3a023785be8985205d371580ba27 is already running'
        );
        done();
      });
    });

    it('should callback error if invalid space allocation', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          statSync: sinon.stub(),
          readFileSync: sinon.stub().returns(Buffer.from('{}'))
        },
        './utils': {
          validate: sinon.stub(),
          validateAllocation: sinon.stub().callsArgWith(
            1,
            new Error('Bad space')
          )
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.start('path/to/config', function(err) {
        expect(err.message).to.equal('bad space');
        done();
      });
    });

    it('should fork the share and setup listeners', function(done) {
      let _proc = new EventEmitter();
      _proc.stdout = new Readable({ read: () => null });
      _proc.stderr = new Readable({ read: () => null });
      let _RPC = proxyquire('../lib/api', {
        fs: {
          createWriteStream: sinon.stub().returns(new Writable({
            write: (d, e, cb) => cb()
          })),
          statSync: sinon.stub(),
          readFileSync: sinon.stub().returns(Buffer.from('{}'))
        },
        './utils': {
          validate: sinon.stub(),
          validateAllocation: sinon.stub().callsArg(1)
        },
        child_process: {
          fork: sinon.stub().returns(_proc)
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      let _ipc = sinon.stub(rpc, '_processShareIpc');
      rpc.start('path/to/config', function() {
        let id = rpc.shares.keys().next().value;
        _proc.emit('message', {});
        setImmediate(() => {
          expect(_ipc.called).to.equal(true);
          _proc.emit('exit');
          setImmediate(() => {
            expect(rpc.shares.get(id).readyState).to.equal(RPC.SHARE_STOPPED);
            _proc.emit('error', new Error());
            setImmediate(() => {
              expect(rpc.shares.get(id).readyState).to.equal(RPC.SHARE_ERRORED);
              done();
            });
          });
        });
      });
    });

  });

  describe('#stop', function() {

    it('should callback error if no share', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      rpc.stop('test', function(err) {
        expect(err.message).to.equal('share test is not running');
        done();
      });
    });

    it('should send sigint to process', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let _proc = {
        kill: sinon.stub()
      };
      rpc.shares.set('test', {
        process: _proc,
        readyState: 1
      });
      rpc.stop('test', function() {
        expect(_proc.kill.calledWithMatch('SIGINT')).to.equal(true);
        done();
      });
    });

  });

  describe('#restart', function() {

    it('should call stop and start', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      rpc.shares.set('test', {});
      let stop = sinon.stub(rpc, 'stop').callsArg(1);
      let start = sinon.stub(rpc, 'start').callsArg(1);
      rpc.restart('test', function() {
        expect(stop.called).to.equal(true);
        expect(start.called).to.equal(true);
        done();
      });
    });

    it('should call restart for every share if wildcard', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      rpc.shares.set('test1', {});
      rpc.shares.set('test2', {});
      rpc.shares.set('test3', {});
      let stop = sinon.stub(rpc, 'stop').callsArg(1);
      let start = sinon.stub(rpc, 'start').callsArg(1);
      rpc.restart('*', function() {
        expect(stop.callCount).to.equal(3);
        expect(start.callCount).to.equal(3);
        done();
      });
    });

  });

  describe('#status', function() {

    it('should return the share statuses', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let meta = {};
      rpc.shares.set('test', {
        config: 'CONFIG',
        readyState: 'READYSTATE',
        meta: meta
      });
      rpc.status(function(err, status) {
        expect(status[0].id).to.equal('test');
        expect(status[0].config).to.equal('CONFIG');
        expect(status[0].state).to.equal('READYSTATE');
        expect(status[0].meta).to.equal(meta);
        done();
      });
    });

  });

  describe('#killall', function() {

    it('should destroy shares and exit process', function() {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let destroy = sinon.stub(rpc, 'destroy').callsArg(1);
      let exit = sinon.stub(process, 'exit');
      rpc.shares.set('test1', {});
      rpc.shares.set('test2', {});
      rpc.shares.set('test3', {});
      rpc.killall(() => {
        expect(destroy.callCount).to.equal(3);
        setTimeout(() => {
          expect(exit.called).to.equal(true);
          exit.restore();
        }, 1200);
      });
    });

  });

  describe('#destroy', function() {

    it('should callback error if share not running', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      rpc.shares.set('test', { process: null });
      rpc.destroy('test', function(err) {
        expect(err.message).to.equal('share test is not running');
        done();
      });
    });

    it('should send sigint and delete reference', function(done) {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let kill = sinon.stub();
      rpc.shares.set('test', {
        process: {
          kill: kill
        }
      });
      rpc.destroy('test', function() {
        expect(kill.calledWithMatch('SIGINT')).to.equal(true);
        expect(rpc.shares.has('test')).to.equal(false);
        done();
      });

    });
  });

  describe('#save', function() {

    it('should error if cannot write file', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          writeFile: sinon.stub().callsArgWith(2, new Error('Failed'))
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.save('save/path', (err) => {
        expect(err.message).to.equal(
          'failed to write snapshot, reason: Failed'
        );
        done();
      });
    });

    it('should write the snapshot file', function(done) {
      let writeFile = sinon.stub().callsArgWith(2, null);
      let _RPC = proxyquire('../lib/api', {
        fs: {
          writeFile: writeFile
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.shares.set('test1', { path: 'path/1' });
      rpc.shares.set('test2', { path: 'path/2' });
      rpc.shares.set('test3', { path: 'path/3' });
      rpc.save('save/path', (err) => {
        expect(err).to.equal(null);
        expect(writeFile.calledWithMatch('save/path', JSON.stringify([
          { path: 'path/1', id: 'test1' },
          { path: 'path/2', id: 'test2' },
          { path: 'path/3', id: 'test3' }
        ], null, 2))).to.equal(true);
        done();
      });
    });

  });

  describe('#load', function() {

    it('should error if cannot read snapshot', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          readFile: sinon.stub().callsArgWith(1, new Error('Failed'))
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.load('load/path', (err) => {
        expect(err.message).to.equal(
          'failed to read snapshot, reason: Failed'
        );
        done();
      });
    });

    it('should error if cannot parse snapshot', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          readFile: sinon.stub().callsArgWith(1, null, Buffer.from('notjson'))
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      rpc.load('load/path', (err) => {
        expect(err.message).to.equal(
          'failed to parse snapshot'
        );
        done();
      });
    });

    it('should start all of the shares in the snapshot', function(done) {
      let _RPC = proxyquire('../lib/api', {
        fs: {
          readFile: sinon.stub().callsArgWith(
            1,
            null,
            Buffer.from(
              `[
                 { "path": "test/1" },
                 { "path": "test/2" },
                 { "path": "test/3" },
                 { "path": "test/4" },
                 { "path": "test/5" }
              ]`
            )
          )
        }
      });
      let rpc = new _RPC({ loggerVerbosity: 0 });
      let start = sinon.stub(rpc, 'start').callsArg(1);
      rpc.load('load/path', () => {
        expect(start.callCount).to.equal(5);
        expect(start.getCall(0).calledWithMatch('test/1'));
        expect(start.getCall(1).calledWithMatch('test/2'));
        expect(start.getCall(2).calledWithMatch('test/3'));
        expect(start.getCall(3).calledWithMatch('test/4'));
        expect(start.getCall(4).calledWithMatch('test/5'));
        done();
      });
    });

  });

  describe('get#methods', function() {

    it('should return the public methods', function() {
      let rpc = new RPC({ loggerVerbosity: 0 });
      let methods = Object.keys(rpc.methods);
      expect(methods.includes('start')).to.equal(true);
      expect(methods.includes('restart')).to.equal(true);
      expect(methods.includes('stop')).to.equal(true);
      expect(methods.includes('destroy')).to.equal(true);
      expect(methods.includes('status')).to.equal(true);
      expect(methods.includes('killall')).to.equal(true);
    });

  });

});
