const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    pool: {
      max: 20,
      min: 0,
      idle: 30000,
      acquire: 2000,
    },
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
);

// Import model definitions
const User = require("./User")(sequelize);
const Course = require("./Course")(sequelize);
const CourseContent = require("./CourseContent")(sequelize);
const Enrollment = require("./Enrollment")(sequelize);
const LearningSession = require("./LearningSession")(sequelize);
const Skill = require("./Skill")(sequelize);
const CourseSkill = require("./CourseSkill")(sequelize);
const UserSkill = require("./UserSkill")(sequelize);
const Test = require("./Test")(sequelize);
const TestQuestion = require("./TestQuestion")(sequelize);
const QuestionOption = require("./QuestionOption")(sequelize);
const TestAttempt = require("./TestAttempt")(sequelize);
const TestAnswer = require("./TestAnswer")(sequelize);
const Assignment = require("./Assignment")(sequelize);
const Notification = require("./Notification")(sequelize);
const MentorshipMessage = require("./MentorshipMessage")(sequelize);
const Kudos = require("./Kudos")(sequelize);
const Journal = require("./Journal")(sequelize);

// ========== ASSOCIATIONS ==========

// User self-reference (supervisor)
User.belongsTo(User, { as: "Supervisor", foreignKey: "supervisor_id" });
User.hasMany(User, { as: "Learners", foreignKey: "supervisor_id" });

// User <-> Course (creator)
User.hasMany(Course, { foreignKey: "created_by", as: "CreatedCourses" });
Course.belongsTo(User, { foreignKey: "created_by", as: "Creator" });

// Course <-> CourseContent
Course.hasMany(CourseContent, {
  foreignKey: "course_id",
  as: "Contents",
  onDelete: "CASCADE",
});
CourseContent.belongsTo(Course, { foreignKey: "course_id" });

// User <-> Enrollment <-> Course
User.hasMany(Enrollment, { foreignKey: "user_id" });
Enrollment.belongsTo(User, { foreignKey: "user_id" });
Course.hasMany(Enrollment, { foreignKey: "course_id" });
Enrollment.belongsTo(Course, { foreignKey: "course_id" });

// User <-> LearningSession
User.hasMany(LearningSession, { foreignKey: "user_id" });
LearningSession.belongsTo(User, { foreignKey: "user_id" });

// Course <-> Skill (many-to-many through CourseSkill)
Course.belongsToMany(Skill, {
  through: CourseSkill,
  foreignKey: "course_id",
  otherKey: "skill_id",
  as: "Skills",
});
Skill.belongsToMany(Course, {
  through: CourseSkill,
  foreignKey: "skill_id",
  otherKey: "course_id",
  as: "Courses",
});
Course.hasMany(CourseSkill, { foreignKey: "course_id" });
CourseSkill.belongsTo(Course, { foreignKey: "course_id" });
Skill.hasMany(CourseSkill, { foreignKey: "skill_id" });
CourseSkill.belongsTo(Skill, { foreignKey: "skill_id" });

// User <-> Skill (many-to-many through UserSkill)
User.belongsToMany(Skill, {
  through: UserSkill,
  foreignKey: "user_id",
  otherKey: "skill_id",
  as: "Skills",
});
Skill.belongsToMany(User, {
  through: UserSkill,
  foreignKey: "skill_id",
  otherKey: "user_id",
  as: "Users",
});
User.hasMany(UserSkill, { foreignKey: "user_id" });
UserSkill.belongsTo(User, { foreignKey: "user_id" });
Skill.hasMany(UserSkill, { foreignKey: "skill_id" });
UserSkill.belongsTo(Skill, { foreignKey: "skill_id" });

// Course <-> Test
Course.hasMany(Test, { foreignKey: "course_id", onDelete: "CASCADE" });
Test.belongsTo(Course, { foreignKey: "course_id" });
User.hasMany(Test, { foreignKey: "created_by", as: "CreatedTests" });
Test.belongsTo(User, { foreignKey: "created_by", as: "Creator" });

// Test <-> TestQuestion
Test.hasMany(TestQuestion, {
  foreignKey: "test_id",
  as: "Questions",
  onDelete: "CASCADE",
});
TestQuestion.belongsTo(Test, { foreignKey: "test_id" });

// TestQuestion <-> QuestionOption
TestQuestion.hasMany(QuestionOption, {
  foreignKey: "question_id",
  as: "Options",
  onDelete: "CASCADE",
});
QuestionOption.belongsTo(TestQuestion, { foreignKey: "question_id" });

// Test <-> TestAttempt
Test.hasMany(TestAttempt, { foreignKey: "test_id", as: "Attempts" });
TestAttempt.belongsTo(Test, { foreignKey: "test_id" });
User.hasMany(TestAttempt, { foreignKey: "user_id" });
TestAttempt.belongsTo(User, { foreignKey: "user_id" });
User.hasMany(TestAttempt, { foreignKey: "graded_by", as: "GradedAttempts" });
TestAttempt.belongsTo(User, { foreignKey: "graded_by", as: "Grader" });

// TestAttempt <-> TestAnswer
TestAttempt.hasMany(TestAnswer, {
  foreignKey: "attempt_id",
  as: "Answers",
  onDelete: "CASCADE",
});
TestAnswer.belongsTo(TestAttempt, { foreignKey: "attempt_id" });
TestQuestion.hasMany(TestAnswer, { foreignKey: "question_id" });
TestAnswer.belongsTo(TestQuestion, { foreignKey: "question_id" });
QuestionOption.hasMany(TestAnswer, { foreignKey: "selected_option_id" });
TestAnswer.belongsTo(QuestionOption, {
  foreignKey: "selected_option_id",
  as: "SelectedOption",
});

// User <-> Assignment <-> Course
User.hasMany(Assignment, { foreignKey: "user_id" });
Assignment.belongsTo(User, { foreignKey: "user_id", as: "Student" });
Course.hasMany(Assignment, { foreignKey: "course_id" });
Assignment.belongsTo(Course, { foreignKey: "course_id" });
User.hasMany(Assignment, {
  foreignKey: "reviewed_by",
  as: "ReviewedAssignments",
});
Assignment.belongsTo(User, { foreignKey: "reviewed_by", as: "Reviewer" });

// User <-> Notification
User.hasMany(Notification, { foreignKey: "user_id" });
Notification.belongsTo(User, { foreignKey: "user_id" });

// User <-> MentorshipMessage
User.hasMany(MentorshipMessage, {
  foreignKey: "sender_id",
  as: "SentMessages",
});
User.hasMany(MentorshipMessage, {
  foreignKey: "receiver_id",
  as: "ReceivedMessages",
});
MentorshipMessage.belongsTo(User, { foreignKey: "sender_id", as: "Sender" });
MentorshipMessage.belongsTo(User, {
  foreignKey: "receiver_id",
  as: "Receiver",
});
Course.hasMany(MentorshipMessage, { foreignKey: "course_id" });
MentorshipMessage.belongsTo(Course, { foreignKey: "course_id" });

// User <-> Kudos
User.hasMany(Kudos, { foreignKey: "from_user_id", as: "KudosGiven" });
User.hasMany(Kudos, { foreignKey: "to_user_id", as: "KudosReceived" });
Kudos.belongsTo(User, { foreignKey: "from_user_id", as: "FromUser" });
Kudos.belongsTo(User, { foreignKey: "to_user_id", as: "ToUser" });

// User <-> Journal
User.hasMany(Journal, { foreignKey: "user_id" });
Journal.belongsTo(User, { foreignKey: "user_id" });

module.exports = {
  sequelize,
  User,
  Course,
  CourseContent,
  Enrollment,
  LearningSession,
  Skill,
  CourseSkill,
  UserSkill,
  Test,
  TestQuestion,
  QuestionOption,
  TestAttempt,
  TestAnswer,
  Assignment,
  Notification,
  MentorshipMessage,
  Kudos,
  Journal,
};
