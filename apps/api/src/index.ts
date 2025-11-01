import { Hono } from 'hono'
import { cors } from 'hono/cors'

import accounts from '@routes/accounts'
import digests from '@routes/digests'
import media from '@routes/media'
import posts from '@routes/posts'
import settings from '@routes/settings'

const app = new Hono()

// app.use('/*', cors({
//   origin: ['http://localhost:3000'],
//   allowHeaders: ['X-Custom-Header'],
// }))

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/accounts', accounts)
app.route('/digests', digests)
app.route('/media', media)
app.route('/posts', posts)
app.route('/settings', settings)


export default app
