import StackTrace from 'stacktrace-js';
import { merge } from 'lodash-es';
import { formatComponentName } from '@eagle-tracker/utils';
import Eagle from '../../../index';
import { ErrorType, TransportCategory } from '../../types/enum';
import {
  ITrackerOption, IErrorLog, IJsErrorLog, IHttplog, IPromiseErrorLog, IVueErrorLog,
} from '../../types';
import { LifeCycleName } from '../../types/core';

export default class Tracker {
  private options: ITrackerOption = {
    enable: true,
    sampling: 1,
  };

  // 存放已上报过或者正处在errorList中的错误uid
  private errorSet = new Set<string>();

  // 插件挂载的宿主
  private host: Eagle;

  /**
   * 错误监控类
   * @param host 插件宿主
   * @param opt 插件配置
   */
  constructor(host: Eagle, opt?: Partial<ITrackerOption>) {
    this.host = host;
    // 覆盖默认配置
    this.options = merge(this.options, opt);

    // 不监控错误
    if (!this.options.enable) {
      this.host.console('log', '已关闭监控JS运行时错误，如需开启请设置record.tracker.enable为true', '配置提示');
    } else {
      this.initJsError();
      this.intitPromiseError();
      this.initHttpError();
    }
  }

  isSafe(errorUid: string) {
    return !this.errorSet.has(errorUid);
  }

  /**
   * 初始化jserror
   */
  initJsError() {
    window.addEventListener('error', (async (event) => {
      // 阻止错误冒泡，避免在控制台出现
      event.preventDefault();
      // 在控制台打印错误
      this.host.console('error', event.error, '发生了js运行时错误');

      const errorUid = this.host.getErrorUid(
        this.getErrorUidInput(ErrorType.JS, event.message, event.filename),
      );
      if (this.errorSet.has(errorUid)) {
        return;
      }
      this.errorSet.add(errorUid);

      const stack = await StackTrace.fromError(event.error);
      // 收集错误信息
      const errorLog: IJsErrorLog = {
        title: document.title,
        errorType: ErrorType.JS,
        mechanism: 'onerror',
        message: event.error.message,
        url: `${window.location.href}${window.location.pathname}`,
        timestamp: Date.now(),
        filename: event.filename,
        stack,
        errorUid,
        type: this.host.parseTypeError(event.message),
      };
      this.host.runLifeCycle(LifeCycleName.ERROR, [ErrorType.JS, errorLog]);
      this.handleError(errorLog);
    }), true);
  }

  /**
   * 初始化promise错误监控
   */
  intitPromiseError() {
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      // 在控制台打印错误
      this.host.console('log', `reason: ${JSON.stringify(event.reason)}`, event.promise, 'Promise被拒绝了');
      const errorUid = this.host.getErrorUid(this.getErrorUidInput(ErrorType.UJ, event.reason));
      if (this.errorSet.has(errorUid)) {
        return;
      }

      const { reason } = event;
      const errorLog: IPromiseErrorLog = {
        title: document.title,
        errorType: ErrorType.UJ,
        mechanism: 'onunhandledrejection',
        url: `${window.window.location.href}${window.window.location.pathname}`,
        timestamp: Date.now(),
        type: event.type,
        errorUid,
        reason,
      };
      this.errorSet.add(errorUid);
      // 执行LifeCycleName.ERROR类型的生命周期回调
      this.host.runLifeCycle(LifeCycleName.ERROR, [ErrorType.UJ, errorLog]);
      this.handleError(errorLog);
    }, true);
  }

  /**
   * 初始化Http错误监控
   */
  initHttpError() {
    const loadHandler = (reqInfo: IHttplog) => {
      if (reqInfo.status < 400) return;
      this.host.console('log', reqInfo, 'Http请求错误');

      const errorUid = this.host.getErrorUid(this.getErrorUidInput(
        ErrorType.API,
        reqInfo.response,
        reqInfo.statusText,
        reqInfo.status,
      ));
      if (this.errorSet.has(errorUid)) {
        return;
      }
      const errorLog: IErrorLog = {
        title: document.title,
        errorType: ErrorType.API,
        mechanism: 'onloadend',
        url: `${window.window.location.href}${window.window.location.pathname}`,
        timestamp: Date.now(),
        meta: reqInfo,
        errorUid,
      };
      this.errorSet.add(errorUid);
      this.host.runLifeCycle(LifeCycleName.ERROR, [ErrorType.API, errorLog]);
      this.handleError(errorLog);
    };

    // 代理XMLHttpRequest和fetch，拦截错误
    this.proxyXMLHttpRequest(loadHandler);
    this.proxyFetch(loadHandler);
  }

  /**
   * 覆盖XMLHttpRequest
   * @param loadHandler 请求结束时 回调
   * @param sendHandler 请求开始前 回调
   */
  private proxyXMLHttpRequest(
    loadHandler: (data: IHttplog) => void,
    sendHandler?: (xhr: XMLHttpRequest) => void,
  ) {
    if (!window.XMLHttpRequest || typeof window.XMLHttpRequest !== 'function') {
      return;
    }
    // 保存原始XMLHttpRequest
    const OriginXMLHttpRequest = window.XMLHttpRequest;
    // 重写XMLHttpRequest
    (window as any).XMLHttpRequest = function CustomXMLHttpRequest() {
      const xhr = new OriginXMLHttpRequest();
      const { open, send } = xhr;
      // 收集http请求相关信息
      const metrics = {} as IHttplog;

      // 重写open方法收集请求方式、请求url
      xhr.open = (method: string, url: string | URL) => {
        metrics.method = method;
        metrics.url = url;
        open.call(xhr, method, url, true);
      };

      // 重写send方法收集请求体、请求开始时间
      xhr.send = (body) => {
        metrics.body = body;
        metrics.requestTime = new Date().getTime();
        if (typeof sendHandler === 'function') sendHandler(xhr);
        send.call(xhr, body);
      };

      // 监听请求结束事件，收集状态，响应，响应时间 并调用外部结束回调
      xhr.addEventListener('loadend', () => {
        const { status, statusText, response } = xhr;
        metrics.status = status;
        metrics.statusText = statusText;
        metrics.response = response;
        metrics.responseTime = new Date().getTime();
        if (typeof loadHandler === 'function') loadHandler(metrics);
      });

      return xhr;
    };
  }

  /**
   * 覆盖fetch方法
   * @param loadHandler 请求结束时 回调
   * @param sendHandler 请求开始前 回调
   */
  private proxyFetch(
    loadHandler: (data: IHttplog) => void,
    sendHandler?: (init?: RequestInit) => void,
  ) {
    if (!window.fetch || typeof window.fetch !== 'function') {
      return;
    }

    const originFetch = window.fetch;
    (window as any).fetch = async (input: any, init: RequestInit | undefined) => {
      if (typeof sendHandler === 'function') sendHandler(init);
      const metrics = {} as IHttplog;

      metrics.method = init?.method || '';
      metrics.url = (typeof input === 'string' ? input : input?.url) || '';
      metrics.body = init?.body || '';
      metrics.requestTime = Date.now();

      return originFetch.call(window, input, init).then(async (response) => {
        const res = response.clone();

        metrics.status = res.status;
        metrics.statusText = res.statusText;
        metrics.response = await res.text();
        metrics.responseTime = Date.now();

        if (typeof loadHandler === 'function') {
          loadHandler(metrics);
        }
        return response;
      });
    };
  }

  /**
   * 监控vue运行时错误
   * @returns 返回错误处理函数
   */
  vueErrorhandler() {
    // 获取vue的app实例，从配置中获取
    const app = this.host.configInstance.get('famework.app');
    // 业务中注册的vue错误处理函数
    const originErrorHandler = app.config.errorHandler;

    // 处理函数
    const handler = async (err: Error, vm: any, info: any) => {
      this.host.console('error', err, 'vue组件错误');
      const stack = await StackTrace.fromError(err);
      const errorLog: IVueErrorLog = {
        title: document.title,
        errorType: ErrorType.VUE,
        mechanism: 'vueErrorhandler',
        message: err.message,
        url: `${window.location.href}${window.location.pathname}`,
        timestamp: Date.now(),
        stack,
        hook: info,
        errorUid: this.host.getErrorUid(
          this.getErrorUidInput(ErrorType.VUE, err.message, info),
        ),
        componentName: formatComponentName(vm, true),
      };
      this.host.runLifeCycle(LifeCycleName.ERROR, [ErrorType.VUE, errorLog]);

      // 被errorHandler拦截的错误不会出现在控制台中，所以需要额外打印出来
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        this.host.console('error', err, 'vue错误');
      }

      // 上报
      if (!this.errorSet.has(errorLog.errorUid)) {
        this.host.transportInstance.log(TransportCategory.VUEERROR, errorLog);
        this.errorSet.add(errorLog.errorUid);
      }

      // 这一步是执行一遍原有的错误处理函数，防止破坏业务侧的代码
      if (typeof originErrorHandler === 'function') {
        originErrorHandler.call(this, err, vm, info);
      }
    };
    return handler;
  }

  /**
   * 生成用于getErrorUid的输入
   * @param args 各个分量
   * @returns 用-连接各个分量的字符串
   */
  getErrorUidInput(...args: (string | number)[]) {
    return args.join('-');
  }

  /**
   * 根据采样率决定错误是否需要处理
   * @param sampling 采样率
   * @returns {boolean}
   */
  private needReport(sampling = 1) {
    return Math.random() < (sampling || 1);
  }

  /**
   * 处理错误
   * @param errorLog 错误信息
   * @returns
   */
  private handleError(errorLog: IErrorLog) {
    // 采样率决定不需要上报
    if (!this.needReport()) {
      return;
    }
    this.host.transportInstance.log(TransportCategory.ERROR, errorLog);
  }
}
