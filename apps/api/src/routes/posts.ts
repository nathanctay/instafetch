import { Hono } from 'hono'

import { db } from '@/db'
import { posts, media } from '@/db/schema'
import { count, eq } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler, newPostSchema, paginationSchema, updatePostSchema } from '@lib/validators'

const app = new Hono()



app.get(
    '/',
    vValidator('query', paginationSchema, validationErrorHandler),
    async (c) => {
        const { page, limit } = c.req.valid('query')

        const offset = (page - 1) * limit;

        try {
            const [data, totalCountResult] = await Promise.all([
                db.query.posts.findMany({
                    limit,
                    offset,
                    orderBy: (posts, { desc }) => [desc(posts.publishedAt)]
                }),

                db.select({ count: count() }).from(posts)
            ]);

            const totalCount = totalCountResult[0].count;
            const totalPages = Math.ceil(totalCount / limit);

            // 5. Return the data with pagination metadata
            return c.json({
                data: data,
                meta: {
                    total: totalCount,
                    page: page,
                    limit: limit,
                    totalPages: totalPages,
                }
            });

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.get(
    '/:id',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("ID is required"),
                v.uuid("Invalid ID")
            )
        }),
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')

        try {
            const result = await db.select()
                .from(posts)
                .where(eq(posts.id, id));

            if (result.length === 0) {
                return c.json({ error: 'Post not found' }, 404);
            }

            return c.json(result[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.get(
    '/:id/media',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("Post ID is required"),
                v.uuid("Invalid ID")
            )
        }),
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')

        try {
            const [postCheck, mediaResult] = await Promise.all([
                db.query.posts.findFirst({
                    where: eq(posts.id, id),
                    columns: { id: true } // Only need the ID to confirm existence
                }),
                db.select()
                    .from(media)
                    .where(eq(media.postId, id))
            ])
            if (!postCheck) {
                return c.json({ error: 'Post not found' }, 404);
            }

            return c.json(mediaResult);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.post('/', vValidator('json', newPostSchema, validationErrorHandler), async (c) => {
    try {
        const validatedData = await c.req.valid('json')

        const newPost = await db.insert(posts).values({
            id: crypto.randomUUID(),
            ...validatedData
        }).returning()

        return c.json(newPost[0], 201)
    } catch (err) {
        console.error(err)

        if (
            err.cause?.code === 'SQLITE_CONSTRAINT' &&
            err.cause.message.includes('UNIQUE constraint failed: posts.account_id, posts.shortcode')
        ) {
            return c.json({ error: 'This shortcode already exists for this account' }, 409);
        }

        return c.json({ error: 'Invalid request or database error' }, 500)
    }
})

app.patch(
    '/:id',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("ID is required"),
                v.uuid("Invalid ID")
            )
        }),
        validationErrorHandler
    ),
    vValidator(
        'json',
        updatePostSchema,
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')
        const validatedData = c.req.valid('json')

        if (Object.keys(validatedData).length === 0) {
            return c.json({ error: 'At least one field must be provided to update' }, 400);
        }

        try {
            const updatedPost = await db
                .update(posts)
                .set(validatedData)
                .where(eq(posts.id, id))
                .returning()

            if (updatedPost.length === 0) {
                return c.json({ error: 'Post not found' }, 404)
            }

            return c.json(updatedPost[0])
        } catch (err) {
            console.error(err)
            if (
                err.cause?.code === 'SQLITE_CONSTRAINT' &&
                err.cause.message.includes('UNIQUE constraint failed: posts.accountId, posts.shortcode')
            ) {
                return c.json({ error: 'This shortcode already exists for this account' }, 409);
            }
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    }
)

app.delete(
    '/:id',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("ID is required"),
                v.uuid("Invalid ID")
            )
        }),
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')

        try {
            const deletedPost = await db
                .delete(posts)
                .where(eq(posts.id, id))
                .returning();

            if (deletedPost.length === 0) {
                return c.json({ error: 'Post not found' }, 404);
            }

            return c.json(deletedPost[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

export default app