import { EagleTracker } from '@eagle-tracker/core/index.ts'

const instance = new EagleTracker({
  isTest: true,
  appId: 'test123',
  dsn: 'http://weiwei8848.com/log/log.png',
  uid: '88888',
  record: {
    timeOnPage: true,
  },
})
instance.start()
export default instance