# FCM Server & Client Setup

1. **Get Credentials**
   First, obtain the required credentials from the Firebase Cloud Messaging (FCM) console.
   Copy the contents of `env.example` to a new file named `.env` and replace all placeholder values with your actual credentials.

2. **Service Account Keys**
   Download the service account keys for both the Python and Node.js applications from the FCM console.
   Save them in the `data/` directory, ensuring each file has a unique name.

3. **Update Docker Configuration**
   If you've used different filenames for the service account keys, update the `docker-compose.yml` file accordingly to reflect the correct paths.

4. **Start the System**
   Run the following command to build and start all services in the background:

   ```bash
   docker-compose up --build -d
   ```

   This will launch:

   * An FCM Node.js server with two clients to be connected 
   * An FCM Python server with two clients to be connected

   Clients are not connected at the start phase.

5. **Learn More**
   For a detailed explanation of how the system works, check out the accompanying Medium article:
   [Building a Complete Firebase Cloud Messaging System — Node.js & Python Servers + Client Apps](https://akpolatcem.medium.com/building-a-complete-firebase-cloud-messaging-system-node-js-python-servers-client-apps-affef8b18bec)

