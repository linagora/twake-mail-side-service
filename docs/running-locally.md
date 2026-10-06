# Running locally

Start RabbitMQ and PostgreSQL:

```sh
docker run -d --name tmss-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4-management-alpine
docker run -d --name tmss-postgres -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16-alpine
```

The service only checks the source exchanges, so declare them as their publishers would:

```sh
for x in space admin-panel b2b; do
  docker exec tmss-rabbitmq rabbitmqadmin declare exchange --name $x --type topic --durable true
done
```

Run the service:

```sh
RABBITMQ_URL=amqp://guest:guest@localhost:5672 \
DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres \
npm run dev
```

`curl localhost:8080/readyz` answers `{"status":"ready"}` once the queue is bound. Publish a test event:

```sh
docker exec tmss-rabbitmq rabbitmqadmin publish --exchange space --routing-key twake.space.created \
  --payload '{"organizationId":"acme","id":"3b9e2c71-5d4a-4f0e-9c8b-1a2d6e7f8091","name":"Design Sprint"}'
```
