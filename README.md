# fcm-server-client
First obtain the required credentials from FCM console and copy `env.example` to `.env` , and replace all values with your own.
Download service account keys for python and nodejs applications in FCM console, and place them in `data/` folder with different name.
Update `docker-compose.yml` file with the service account file names if you have different names in `docker-compose.yml`
Finally run `docker-compose up --build -d`, which will start
- FCM NodeJS server and 2 Clients that will be connected to it
- FCM Python server and 2 Clients that will be connected to it