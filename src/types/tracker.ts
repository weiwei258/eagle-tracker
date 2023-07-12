interface IBasicErrorLog {
  /**
  * 页面标题
  */
  title: string
  /**
   * 错误类型
   */
  errorType: 'jsError' | 'promiseError' | 'resourceError'
  /**
   * 行号
   */
  lineno: number
  /**
   * 列号
   */
  colno: number
  /**
   * 发生错误的时间戳
   */
  timestamp: number
  /**
   * 发生错误页面的路径
   */
  url: string
  /**
   * 捕获到错误的事件
   */
  mechanism: 'onerror' | 'onunhandledrejection'
}

interface IJsErrorLog extends IBasicErrorLog {
  /**
   * 发生错误的代码文件
   */
  filename: string
  /**
   * 具体错误信息
   */
  message: string
  /**
   * js错误类型 类似TypeError SyntaxError
   */
  type: string
  /**
   * 错误堆栈
   */
  stack: string,
}

interface IPromiseErrorLog extends IBasicErrorLog {
  type: string
  /**
   * promise被拒绝的原因
   */
  reason: string
}

/** 统一错误信息类型 */
type IErrorLog = IJsErrorLog | IPromiseErrorLog

interface IDefOption {
  concat: boolean,
  /**
   * 错误处理间隔时间
   */
  delay: number,
  /**
   * 异常报错数量限制
   */
  maxError: number,
  /**
   * 采样率
   */
  sampling: number,
  /**
   * 上报逻辑
   * @param log 错误信息或者错误列表
   * @returns
   */
  report: (log: IErrorLog | IErrorLog[]) => void
}
